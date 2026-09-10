import Stripe from 'npm:stripe@^22'
import { getAdminClient, stripeId } from './stripe-webhook.ts'
import { loadRecoveryOrder, reconcileCheckout } from './payment-recovery.ts'
import { processStoreSettlement } from './order-settlement.ts'
import { processPaidOrderEmails } from './order-email-queue.ts'
import { captureEdgeError } from './security.ts'

export const isStorePaymentEvent = (event: Stripe.Event) => {
  if (['charge.updated', 'refund.updated', 'refund.failed'].includes(event.type)) return true
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
    const piId = stripeId(object.payment_intent)
    if (!piId) return true
    const { data, error } = await admin.from('orders').select('id')
      .eq('stripe_payment_intent_id', piId).eq('stripe_mode', mode).maybeSingle()
    if (error) throw error
    orderId = data?.id ?? null
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
