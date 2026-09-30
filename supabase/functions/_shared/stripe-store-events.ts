import Stripe from 'npm:stripe@^22'
import { getAdminClient, stripeId } from './stripe-webhook.ts'
import { loadRecoveryOrder, reconcileCheckout } from './payment-recovery.ts'
import { processStoreSettlement } from './order-settlement.ts'
import { processPaidOrderEmails } from './order-email-queue.ts'
import { captureEdgeError } from './security.ts'

export const isStorePaymentEvent = (event: Stripe.Event) => {
  if (['charge.updated', 'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed',
    'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated'].includes(event.type)) return true
  const object = event.data.object as unknown as Stripe.Checkout.Session
  return ['checkout.session.completed', 'checkout.session.async_payment_succeeded',
    'checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type)
    && object.mode === 'payment' && !!object.metadata?.order_id
}

export const handleStorePaymentEvent = async (event: Stripe.Event, followups = true) => {
  if (!isStorePaymentEvent(event)) return false
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) throw new Error('Puudub STRIPE_SECRET_KEY.')
  const admin = getAdminClient()
  const mode = event.livemode ? 'live' : 'test'
  const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient(), timeout: 10_000, maxNetworkRetries: 1 })
  const object = event.data.object as unknown as Stripe.Checkout.Session
  let orderId: string | null
  if (event.type.startsWith('checkout.session.')) {
    const order = await loadRecoveryOrder(admin, object.metadata!.order_id)
    await reconcileCheckout({ admin, stripe, mode }, order, object.id)
    orderId = order.id
  } else {
    const incoming = event.data.object as unknown as { id: string; charge?: string | Stripe.Charge }
    const dispute = event.type.startsWith('charge.dispute.') ? await stripe.disputes.retrieve(incoming.id) : null
    const chargeId = dispute ? stripeId(dispute.charge) : event.type.startsWith('refund.') ? stripeId(incoming.charge) : incoming.id
    if (!chargeId) return true
    // Read current Stripe state; event delivery order is not authoritative.
    const charge = await stripe.charges.retrieve(chargeId)
    const piId = stripeId(charge.payment_intent)
    if (!piId) return true
    const { data, error } = await admin.from('orders').select('id,total')
      .eq('stripe_payment_intent_id', piId).eq('stripe_mode', mode).maybeSingle()
    if (error) throw error
    orderId = data?.id ?? null
    if (data) {
      if (charge.livemode !== event.livemode || charge.currency !== 'eur' || charge.amount !== Math.round(Number(data.total) * 100)) {
        throw new Error('Stripe’i makse ei vasta tellimusele.')
      }
      const refunds: Stripe.Refund[] = []
      if (charge.amount_refunded > 0 || event.type.startsWith('refund.') || event.type === 'charge.refunded') {
        for await (const refund of stripe.refunds.list({ charge: charge.id, limit: 100 })) refunds.push(refund)
      }
      const succeeded = refunds.filter(refund => refund.status === 'succeeded')
      const refundedCents = succeeded.reduce((sum, refund) => sum + refund.amount, 0)
      const fullRefundId = succeeded.length === 1 && succeeded[0].amount === charge.amount ? succeeded[0].id : null
      const partial = refunds.some(refund => refund.amount !== charge.amount)
      if (refunds.length || dispute) {
        const { error: observeError } = await admin.rpc('observe_stripe_order_payment', {
          target_order_id: data.id, mode_value: mode, refunded_cents: refundedCents,
          full_refund_id: fullRefundId, dispute_id_value: dispute?.id ?? null, dispute_status_value: dispute?.status ?? null,
          refund_review_value: partial && refundedCents < charge.amount ? 'partial_refund' : null,
        })
        if (observeError) throw observeError
        // A pending/failed full refund must wake even an already completed job.
        // The worker inspects its current status and never creates a second one.
        if (!partial && refunds.length === 1 && refundedCents === 0) {
          const { error: requestError } = await admin.rpc('request_stripe_order_refund', { target_order_id: data.id, mode_value: mode })
          if (requestError) throw requestError
        }
      }
    }
  }
  // Recovery confirms and enqueues only. Each durable follow-up worker can
  // reclaim its own crashed job; no accepted email or completed transfer resets.
  if (!orderId || !followups) return true
  const results = await Promise.allSettled([
    processPaidOrderEmails({ admin, onError: (error, job) => captureEdgeError('order-emails', error,
      { order_id: job.order_id, job_id: job.id, recipient_kind: job.kind }, 'critical') }, mode, orderId),
    Deno.env.get('STRIPE_SETTLEMENT_WORKER_ENABLED') === 'false' ? Promise.resolve() : processStoreSettlement({ admin, stripe,
      onError: (error, id, status) => captureEdgeError('stripe-order-settlements', error,
        { order_id: id, settlement_status: status }, 'critical') }, mode, orderId),
  ])
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (errors.length) throw new AggregateError(errors.map((result) => result.reason), 'Tellimuse järeltoiming katkes.')
  return true
}
