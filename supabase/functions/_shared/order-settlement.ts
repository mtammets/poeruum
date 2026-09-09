import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type Stripe from 'npm:stripe@^22'
import { assertStoredStripeMode, type StripeMode } from './stripe-mode.ts'

export type SettlementStatus = 'pending' | 'waiting_for_fee' | 'processing' | 'retry' | 'completed' | 'refund_pending' | 'refunded' | 'needs_review'
export type SettlementAmounts = {
  processing_fee_cents: number
  platform_fee_net_cents: number
  platform_fee_vat_cents: number
  seller_net_cents: number
}
export type SettlementJob = {
  order_id: string
  stripe_mode: StripeMode
  status: SettlementStatus
  lease_token: string
  lease_expires_at: string
  transfer_payload: Stripe.TransferCreateParams | null
  settlement_data: SettlementAmounts | null
  transfer_started_at: string | null
  refund_requested_at: string | null
  refund_payload: Stripe.RefundCreateParams | null
  refund_started_at: string | null
  stripe_refund_id: string | null
}
type SettlementOrder = {
  id: string
  store_id: string
  order_number: string
  total: number | string
  payment_status: string
  stripe_mode: StripeMode | null
  stripe_payment_intent_id: string
  stripe_transfer_id: string | null
  stripe_refund_id: string | null
}
type Services = {
  admin: SupabaseClient
  stripe: Stripe
  onError?: (error: unknown, orderId: string, status: SettlementStatus) => Promise<void>
}

class SettlementReviewError extends Error {}
const objectId = (value: string | { id: string } | null) => typeof value === 'string' ? value : value?.id
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Makse järeltoiming ebaõnnestus.'

// Stay inside Stripe's minimum 24-hour idempotency retention. Older uncertain
// operations are reconciled from Stripe, never blindly submitted as new ones.
const assertReplayWindow = (startedAt: string | null) => {
  if (!startedAt || !Number.isFinite(Date.parse(startedAt)) || Date.now() - Date.parse(startedAt) >= 20 * 60 * 60 * 1000) {
    throw new SettlementReviewError('Stripe’i toimingu tulemus vajab kontrollimist enne uut rahaliigutust.')
  }
}

export const processStoreSettlement = async (services: Services, mode: StripeMode, orderId?: string) => {
  const { admin, stripe } = services
  const { data: claims, error: claimError } = await admin.rpc('claim_stripe_order_settlement', {
    mode_value: mode, target_order_id: orderId ?? null,
  })
  if (claimError) throw claimError
  let job = (claims?.[0] ?? null) as SettlementJob | null
  if (!job) return null
  const claimed = job

  const rpc = async (name: string, values: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, {
      target_order_id: claimed.order_id, token_value: claimed.lease_token, ...values,
    })
    if (error) throw error
    if (!data) throw new Error('SETTLEMENT_LEASE_LOST')
    return data as SettlementJob
  }
  const finish = async (status: SettlementStatus, error?: unknown, refundId?: string) => {
    const result = await rpc('finish_stripe_order_settlement', {
      outcome_value: status, error_value: error ? errorMessage(error) : null, refund_id_value: refundId ?? null,
    })
    return { orderId: claimed.order_id, status: result.status, refundId: result.stripe_refund_id }
  }
  const checkLease = () => rpc('check_stripe_order_settlement_lease', {})

  try {
    const { data: orderData, error: orderError } = await admin.from('orders')
      .select('id,store_id,order_number,total,payment_status,stripe_mode,stripe_payment_intent_id,stripe_transfer_id,stripe_refund_id')
      .eq('id', job.order_id).single()
    if (orderError) throw orderError
    const order = orderData as SettlementOrder
    assertStoredStripeMode(order.stripe_mode, mode, 'Tellimuse makse')
    if (!order.stripe_payment_intent_id || !['paid', 'refunded'].includes(order.payment_status)) {
      throw new SettlementReviewError('Tellimusel puudub kinnitatud makse.')
    }
    const payment = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id, {
      expand: ['latest_charge.balance_transaction'],
    })
    if (payment.status !== 'succeeded' || payment.livemode !== (mode === 'live')
      || payment.metadata.order_id !== order.id || payment.metadata.store_id !== order.store_id
      || payment.currency !== 'eur' || payment.amount_received !== Math.round(Number(order.total) * 100)) {
      throw new SettlementReviewError('Stripe’i makse ei vasta tellimusele.')
    }
    const charge = typeof payment.latest_charge === 'string'
      ? await stripe.charges.retrieve(payment.latest_charge, { expand: ['balance_transaction'] }) : payment.latest_charge
    if (!charge || charge.status !== 'succeeded' || !charge.paid || !charge.captured) {
      throw new Error('Stripe’i kinnitatud maksekanne pole veel saadaval.')
    }

    const findTransfer = async () => {
      const matches: Stripe.Transfer[] = []
      for await (const transfer of stripe.transfers.list({ transfer_group: `order_${order.id}`, limit: 100 })) {
        matches.push(transfer)
        if (matches.length > 1) throw new SettlementReviewError('Tellimusel on Stripe’is mitu ülekannet.')
      }
      return matches[0] ?? null
    }
    const validateTransfer = (transfer: Stripe.Transfer, payload?: Stripe.TransferCreateParams | null) => {
      if (transfer.metadata.order_id !== order.id || objectId(transfer.source_transaction) !== charge.id
        || transfer.currency !== payment.currency
        || (payload && (transfer.amount !== payload.amount || objectId(transfer.destination) !== payload.destination))) {
        throw new SettlementReviewError('Stripe’i ülekanne ei vasta salvestatud maksearvestusele.')
      }
      return transfer
    }
    const recoverPreparedTransfer = async (prepared: SettlementJob) => {
      const payload = prepared.transfer_payload
      if (!payload) throw new SettlementReviewError('Ülekande salvestatud andmed puuduvad.')
      let transfer = order.stripe_transfer_id
        ? await stripe.transfers.retrieve(order.stripe_transfer_id) : await findTransfer()
      if (!transfer) {
        assertReplayWindow(prepared.transfer_started_at)
        await checkLease()
        transfer = await stripe.transfers.create(payload, { idempotencyKey: `poeruum-order-transfer-${order.id}` })
      }
      validateTransfer(transfer, payload)
      job = await rpc('record_stripe_order_transfer', { transfer_id_value: transfer.id })
      order.stripe_transfer_id = transfer.id
      return transfer
    }

    const refund = async (requested: SettlementJob) => {
      // Inspect existing refunds before reversing or creating any transfer.
      let result: Stripe.Refund | null
      const refundId = requested.stripe_refund_id ?? order.stripe_refund_id
      if (refundId) result = await stripe.refunds.retrieve(refundId)
      else {
        const refunds: Stripe.Refund[] = []
        for await (const candidate of stripe.refunds.list({ payment_intent: payment.id, limit: 100 })) refunds.push(candidate)
        if (refunds.length > 1) throw new SettlementReviewError('Makse mitmed tagastused vajavad kontrollimist.')
        result = refunds[0] ?? null
      }
      const validateRefund = (candidate: Stripe.Refund) => {
        if (objectId(candidate.payment_intent) !== payment.id || candidate.amount !== payment.amount_received) {
          throw new SettlementReviewError('Stripe’i tagastus ei vasta tellimusele või on osaline.')
        }
      }
      if (result) {
        validateRefund(result)
        if (!['succeeded', 'pending'].includes(result.status ?? '')) {
          throw new SettlementReviewError(`Stripe’i tagastuse olek on ${result.status ?? 'unknown'}.`)
        }
      }
      let transfer: Stripe.Transfer | null = null
      if (requested.transfer_payload) {
        // Resolve an in-flight transfer before reversing it. This also covers
        // a crash between Stripe accepting the transfer and the database write.
        transfer = await recoverPreparedTransfer(requested)
      } else if (order.stripe_transfer_id) {
        transfer = validateTransfer(await stripe.transfers.retrieve(order.stripe_transfer_id))
      } else if (!payment.transfer_data?.destination && await findTransfer()) {
        throw new SettlementReviewError('Varasem ülekanne vajab sidumist tellimusega enne tagastamist.')
      }
      if (transfer && !transfer.reversed) {
        if (transfer.amount_reversed !== 0) throw new SettlementReviewError('Müüja ülekanne on osaliselt tagasi pööratud.')
        await checkLease()
        await stripe.transfers.createReversal(transfer.id, {}, { idempotencyKey: `poeruum-order-transfer-reversal-${order.id}` })
      }

      if (!result) {
        const prepared = await rpc('prepare_stripe_order_operation', {
          operation_value: 'refund', settlement_value: null,
          payload_value: {
            payment_intent: payment.id,
            ...(payment.transfer_data?.destination ? { reverse_transfer: true, refund_application_fee: true } : {}),
            metadata: { store_id: order.store_id, order_id: order.id, order_number: order.order_number },
          },
        })
        if (!prepared.refund_payload) throw new Error('Tagastuse andmeid ei salvestatud.')
        assertReplayWindow(prepared.refund_started_at)
        await checkLease()
        result = await stripe.refunds.create(prepared.refund_payload, { idempotencyKey: `poeruum-order-refund-${order.id}` })
      }
      validateRefund(result)
      if (result.status === 'succeeded') return finish('refunded', undefined, result.id)
      if (result.status === 'pending') return finish('refund_pending', undefined, result.id)
      const error = new SettlementReviewError(`Stripe’i tagastuse olek on ${result.status ?? 'unknown'}.`)
      const outcome = await finish('needs_review', error, result.id)
      if (services.onError) await services.onError(error, claimed.order_id, 'needs_review')
      return outcome
    }

    if (job.refund_requested_at) return await refund(job)
    if (charge.refunded || charge.amount_refunded > 0 || order.payment_status === 'refunded') {
      throw new SettlementReviewError('Stripe’is tagastatud makse arvestus vajab kontrollimist.')
    }
    if (job.transfer_payload) {
      const transfer = await recoverPreparedTransfer(job)
      if (transfer.amount_reversed > 0 || transfer.reversed) throw new SettlementReviewError('Müüja ülekanne on tagasi pööratud.')
    }
    else if (!order.stripe_transfer_id) {
      if (payment.transfer_data?.destination) throw new SettlementReviewError('Varasem otseülekanne vajab eraldi arvestuse kontrolli.')
      const balance = typeof charge.balance_transaction === 'string'
        ? await stripe.balanceTransactions.retrieve(charge.balance_transaction) : charge.balance_transaction
      if (!balance) return await finish('waiting_for_fee')
      const processingFee = balance.fee
      const platformFee = Number(payment.metadata.platform_fee_cents ?? 0)
      const netFee = Number(payment.metadata.platform_fee_net_cents ?? platformFee)
      const vatFee = Number(payment.metadata.platform_fee_vat_cents ?? 0)
      const sellerNet = payment.amount_received - processingFee - platformFee
      if (![processingFee, platformFee, netFee, vatFee, sellerNet].every((n) => Number.isSafeInteger(n) && n >= 0)
        || netFee + vatFee !== platformFee || sellerNet <= 0) throw new SettlementReviewError('Makse teenustasude jaotus ei klapi.')
      const { data: store, error: storeError } = await admin.from('stores')
        .select('stripe_account_id').eq('id', order.store_id).single()
      if (storeError) throw storeError
      const destination = payment.metadata.seller_account_id || store.stripe_account_id
      if (!destination || destination !== store.stripe_account_id) throw new SettlementReviewError('Müüja Stripe’i konto vajab kontrollimist.')
      job = await rpc('prepare_stripe_order_operation', {
        operation_value: 'transfer',
        payload_value: {
          amount: sellerNet, currency: payment.currency, destination, source_transaction: charge.id,
          transfer_group: `order_${order.id}`, description: `Poeruum ${order.order_number}`,
          metadata: { store_id: order.store_id, order_id: order.id, payment_intent_id: payment.id },
        },
        settlement_value: {
          processing_fee_cents: processingFee, platform_fee_net_cents: netFee,
          platform_fee_vat_cents: vatFee, seller_net_cents: sellerNet,
        },
      })
      if (!job.transfer_payload) return await refund(job)
      await recoverPreparedTransfer(job)
    }
    return await finish('completed')
  } catch (error) {
    // The persisted job, not the lifetime of this invocation or webhook, owns
    // retries. A failed state write must still propagate to the caller.
    const status = error instanceof SettlementReviewError ? 'needs_review' : 'retry'
    const result = await finish(status, error)
    if (services.onError) await services.onError(error, claimed.order_id, status)
    return result
  }
}
