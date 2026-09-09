import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type Stripe from 'npm:stripe@^22'
import { assertStoredStripeMode, type StripeMode } from './stripe-mode.ts'

type PaidCheckout = {
  orderId: string
  storeId: string | null
  sessionId: string
  paymentIntentId: string
  mode: StripeMode
}

type PaymentOrder = {
  id: string
  store_id: string
  order_number: string
  total: number | string
  payment_status: string
  stripe_mode: StripeMode | null
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
}

type PaymentServices = {
  admin: SupabaseClient
  stripe: Stripe
  settleOrder: (orderId: string) => Promise<unknown>
  notifyOrder: (orderId: string) => Promise<unknown>
}

export const confirmPaidStoreOrder = async (services: Pick<PaymentServices, 'admin' | 'stripe'>, checkout: PaidCheckout) => {
  const { admin, stripe } = services
  const { data, error: orderError } = await admin.from('orders')
    .select('id,store_id,order_number,total,payment_status,stripe_mode,stripe_checkout_session_id,stripe_payment_intent_id')
    .eq('id', checkout.orderId).maybeSingle()
  if (orderError) throw orderError
  if (!data) throw new Error('Tellimust ei leitud.')
  const order = data as PaymentOrder
  assertStoredStripeMode(order.stripe_mode, checkout.mode, 'Tellimuse makse')
  if ((checkout.storeId && checkout.storeId !== order.store_id)
    || (order.stripe_checkout_session_id && order.stripe_checkout_session_id !== checkout.sessionId)
    || (order.stripe_payment_intent_id && order.stripe_payment_intent_id !== checkout.paymentIntentId)) {
    throw new Error('Stripe’i makse ei vasta tellimusele.')
  }
  if (order.payment_status === 'refunded') return false

  const paymentIntent = await stripe.paymentIntents.retrieve(checkout.paymentIntentId, {
    expand: ['latest_charge'],
  })
  if (paymentIntent.status !== 'succeeded' || paymentIntent.livemode !== (checkout.mode === 'live')) {
    throw new Error('Stripe’i kinnitatud makse puudub või on vales režiimis.')
  }
  if (paymentIntent.metadata.order_id !== order.id || paymentIntent.metadata.store_id !== order.store_id) {
    throw new Error('Stripe’i makse ei vasta tellimusele.')
  }
  if (paymentIntent.currency !== 'eur' || paymentIntent.amount_received !== Math.round(Number(order.total) * 100)) {
    throw new Error('Stripe’i makse summa või valuuta ei vasta tellimusele.')
  }
  const charge = paymentIntent.latest_charge && typeof paymentIntent.latest_charge === 'object'
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge ? await stripe.charges.retrieve(paymentIntent.latest_charge) : null
  if (!charge || charge.status !== 'succeeded' || !charge.paid || !charge.captured) {
    throw new Error('Stripe’i kinnitatud maksekanne puudub.')
  }
  if (charge.refunded || charge.amount_refunded > 0) throw new Error('Stripe’i makse on juba osaliselt või täielikult tagastatud.')

  // Confirm payment and consume the reservation before any fee lookup, seller
  // transfer or email request. The RPC locks the order and changes stock once.
  const { error: completionError } = await admin.rpc('complete_stripe_order', {
    target_order_id: order.id,
    checkout_session_id: checkout.sessionId,
    payment_intent_id: paymentIntent.id,
  })
  if (completionError) throw completionError
  return true
}

export const completePaidStoreOrder = async (services: PaymentServices, checkout: PaidCheckout) => {
  if (!await confirmPaidStoreOrder(services, checkout)) return

  // Both tasks must be attempted and awaited, even when either one fails.
  // Both have durable jobs. Provider failures retry from those queues; only
  // failure to persist the result requires this webhook to retry as well.
  const results = await Promise.allSettled([
    services.notifyOrder(checkout.orderId),
    services.settleOrder(checkout.orderId),
  ])
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length) {
    throw new AggregateError(failures.map((failure) => failure.reason), failures.map(({ reason }) =>
      reason instanceof Error ? reason.message : 'Tellimuse järeltoiming ebaõnnestus.').join('; '))
  }
}
