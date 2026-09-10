import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type Stripe from 'npm:stripe@^22'
import { confirmPaidStoreOrder } from './store-payment.ts'
import type { StripeMode } from './stripe-mode.ts'

type Services = { admin: SupabaseClient; stripe: Stripe; mode: StripeMode; now?: () => number }
export type RecoveryJob = {
  order_id: string; stripe_mode: StripeMode; lease_token: string; attempts: number
  scan_cursor: string | null; scan_match_id: string | null; scan_until: string | null
}
export type RecoveryOrder = {
  id: string; store_id: string; total: number | string; payment_status: string; stripe_mode: string | null
  stripe_checkout_session_id: string | null; stripe_payment_intent_id: string | null
  stripe_checkout_started_at: string | null; created_at: string; reservation_expires_at: string | null
}
type Outcome = 'pending' | 'waiting' | 'retry' | 'completed' | 'needs_review'
export class PaymentReviewRequired extends Error {}
const columns = 'id,store_id,total,payment_status,stripe_mode,stripe_checkout_session_id,stripe_payment_intent_id,stripe_checkout_started_at,created_at,reservation_expires_at'
const id = (value: string | { id: string } | null) => typeof value === 'string' ? value : value?.id ?? null
export const recoveryRpc = async (admin: SupabaseClient, name: string, args: Record<string, unknown>) => {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw error
  return data
}
export const loadRecoveryOrder = async (admin: SupabaseClient, orderId: string): Promise<RecoveryOrder> => {
  const { data, error } = await admin.from('orders').select(columns).eq('id', orderId).maybeSingle()
  if (error) throw error
  if (!data) throw new PaymentReviewRequired('Tellimust ei leitud.')
  return data as RecoveryOrder
}

// The provider's current state decides the outcome, including for delayed
// failure events. Neither an old event nor a timer proves that payment failed.
export const reconcileCheckout = async (services: Services, order: RecoveryOrder, sessionId: string): Promise<'completed' | 'waiting'> => {
  const { admin, stripe, mode } = services
  if (order.stripe_mode !== mode) throw new PaymentReviewRequired('Tellimus on vales Stripe’i režiimis.')
  if (order.payment_status === 'refunded') return 'completed'
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.latest_charge'] })
  const pi = typeof session.payment_intent === 'object' ? session.payment_intent : null
  const piId = id(session.payment_intent)
  if (piId && !pi) throw new Error('Stripe ei tagastanud makse praegust olekut.')
  if (session.id !== sessionId || (order.stripe_checkout_session_id && order.stripe_checkout_session_id !== sessionId)
    || session.mode !== 'payment' || session.livemode !== (mode === 'live')
    || session.metadata?.order_id !== order.id || session.metadata?.store_id !== order.store_id
    || (session.metadata?.stripe_mode && session.metadata.stripe_mode !== mode)
    || session.client_reference_id !== order.store_id || session.currency !== 'eur'
    || session.amount_total !== Math.round(Number(order.total) * 100)
    || (order.stripe_payment_intent_id && order.stripe_payment_intent_id !== piId)
    || (pi && (pi.livemode !== (mode === 'live') || pi.metadata.order_id !== order.id
      || pi.metadata.store_id !== order.store_id || pi.currency !== 'eur' || pi.amount !== session.amount_total))) {
    throw new PaymentReviewRequired('Tellimuse ja Stripe’i makse andmed ei ühti.')
  }
  await recoveryRpc(admin, 'bind_stripe_checkout', { target_order_id: order.id, session_id_value: session.id, mode_value: mode })
  if (session.payment_status === 'paid') {
    if (session.status !== 'complete' || !piId) throw new PaymentReviewRequired('Kinnitatud makse andmed on puudulikud.')
    const charge = pi && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
    if (charge && (charge.refunded || charge.amount_refunded > 0) && order.payment_status !== 'paid') {
      throw new PaymentReviewRequired('Enne tellimuse kinnitamist tagastatud makse vajab kontrolli.')
    }
    if (order.payment_status !== 'paid') await confirmPaidStoreOrder({ admin, stripe }, {
      orderId: order.id, storeId: order.store_id, sessionId: session.id, paymentIntentId: piId, mode,
    })
    await recoveryRpc(admin, 'repair_paid_order_jobs', { target_order_id: order.id })
    return 'completed'
  }
  if (order.payment_status === 'paid') throw new PaymentReviewRequired('Tellimus on tasutud, kuid Stripe’i olek ei kinnita makset.')
  // requires_payment_method on an OPEN session is retryable by the customer.
  // A COMPLETE async session with a definitive payment failure is terminal.
  const processing = pi && !['canceled', 'requires_payment_method'].includes(pi.status)
  const terminal = session.status === 'expired'
    || (session.status === 'complete' && (pi?.status === 'canceled'
      || (pi?.status === 'requires_payment_method' && !!pi.last_payment_error)))
  if (terminal && !processing) {
    await recoveryRpc(admin, 'release_verified_stripe_order', { target_order_id: order.id, session_id_value: session.id })
    return 'completed'
  }
  if ((services.now?.() ?? Date.now()) - session.created * 1000 > 31 * 86_400_000) {
    throw new PaymentReviewRequired('Makse on üle 31 päeva lahenduseta; reserveering säilib kontrollini.')
  }
  return 'waiting'
}

export const recoverOrderPayment = async (services: Services, job: RecoveryJob): Promise<Outcome> => {
  const { admin, stripe, mode } = services
  let cursor = job.scan_cursor, match = job.scan_match_id, until = job.scan_until
  let outcome: Outcome
  let message: string | null = null
  try {
    if (job.stripe_mode !== mode) throw new PaymentReviewRequired('Taastamistöö on vales Stripe’i režiimis.')
    const order = await loadRecoveryOrder(admin, job.order_id)
    if (order.stripe_mode !== mode) throw new PaymentReviewRequired('Tellimus on vales Stripe’i režiimis.')
    if (order.payment_status === 'paid' && (!order.stripe_payment_intent_id || !order.stripe_checkout_session_id)) {
      throw new PaymentReviewRequired('Tasutuks märgitud tellimuse makseviited on puudulikud.')
    }
    if (order.payment_status === 'paid' || order.payment_status === 'refunded') {
      await recoveryRpc(admin, 'repair_paid_order_jobs', { target_order_id: order.id })
      outcome = 'completed'
    } else if (order.stripe_checkout_session_id) {
      outcome = await reconcileCheckout(services, order, order.stripe_checkout_session_id)
    } else {
      const now = services.now?.() ?? Date.now()
      const { data: attempt, error } = await admin.from('stripe_checkout_attempts').select('payload,started_at').eq('order_id', order.id).maybeSingle()
      if (error) throw error
      if (!attempt && !order.stripe_checkout_started_at && order.payment_status === 'pending') {
        if (order.reservation_expires_at && Date.parse(order.reservation_expires_at) <= now) {
          await recoveryRpc(admin, 'release_stripe_order', { target_order_id: order.id })
          // A concurrent outbound request can have acquired the reservation.
          outcome = (await loadRecoveryOrder(admin, order.id)).payment_status === 'failed' ? 'completed' : 'waiting'
        } else outcome = 'waiting'
      } else {
        // Scan a fixed, bounded creation window to the end before accepting a
        // match or absence. Persist pagination so busy accounts make progress.
        until ??= new Date(now).toISOString()
        const page = await stripe.checkout.sessions.list({ limit: 100,
          created: { gte: Math.floor(Date.parse(order.created_at) / 1000) - 60, lte: Math.floor(Date.parse(until) / 1000) },
          ...(cursor ? { starting_after: cursor } : {}),
          ...(order.stripe_payment_intent_id ? { payment_intent: order.stripe_payment_intent_id } : {}),
        })
        for (const session of page.data) if (session.metadata?.order_id === order.id) {
          if (match && match !== session.id) throw new PaymentReviewRequired('Tellimusega on seotud mitu Stripe’i makselehte.')
          match = session.id
        }
        if (page.has_more) {
          if (!page.data.length || page.data.at(-1)!.id === cursor) throw new Error('Stripe’i lehekülgede lugemine ei edenenud.')
          cursor = page.data.at(-1)!.id
          outcome = 'pending'
        } else if (match) {
          outcome = await reconcileCheckout(services, order, match)
          cursor = null; match = null; until = null
        } else if (!attempt) {
          throw new PaymentReviewRequired('Vana maksekatse tulemus pole tõendatav; automaatset uut makset ei tehta.')
        } else {
          const expiry = Number(attempt.payload.expires_at) * 1000
          if (!Number.isFinite(expiry)) throw new PaymentReviewRequired('Maksekatse aegumine puudub.')
          if (now >= expiry + 60_000 && Date.parse(until) >= expiry) {
            await recoveryRpc(admin, 'release_absent_stripe_checkout', { target_order_id: order.id, scanned_until_value: until })
            outcome = 'completed'
          } else {
            cursor = null; match = null; until = null; outcome = 'waiting'
          }
        }
      }
    }
  } catch (error) {
    outcome = error instanceof PaymentReviewRequired ? 'needs_review' : 'retry'
    message = error instanceof Error ? error.message : 'Makse taastamine ebaõnnestus.'
  }
  await recoveryRpc(admin, 'finish_order_payment_recovery', {
    target_order_id: job.order_id, token_value: job.lease_token, outcome_value: outcome, error_value: message,
    scan_cursor_value: cursor, scan_match_value: match, scan_until_value: until,
  })
  return outcome
}
