import type Stripe from 'npm:stripe@^22'
import {
  claimEvent,
  completeEvent,
  getAdminClient,
  json,
  metadataStoreId,
  releaseEvent,
  stripeId,
  verifyStripeEvent,
} from '../_shared/stripe-webhook.ts'

type StripeRecord = Record<string, unknown>

const updateStore = async (values: Record<string, unknown>, filters: { storeId?: string | null; customerId?: string | null; subscriptionId?: string | null }) => {
  const admin = getAdminClient()
  let query = admin.from('stores').update(values)
  if (filters.storeId) query = query.eq('id', filters.storeId)
  else if (filters.subscriptionId) query = query.eq('stripe_subscription_id', filters.subscriptionId)
  else if (filters.customerId) query = query.eq('stripe_customer_id', filters.customerId)
  else return
  const { error } = await query
  if (error) throw error
}

const handleEvent = async (event: Stripe.Event) => {
  const object = event.data.object as unknown as StripeRecord

  if (event.type === 'checkout.session.completed') {
    const storeId = metadataStoreId(object) ?? (typeof object.client_reference_id === 'string' ? object.client_reference_id : null)
    await updateStore({
      stripe_customer_id: stripeId(object.customer),
      stripe_subscription_id: stripeId(object.subscription),
      stripe_subscription_status: object.mode === 'subscription' ? 'active' : null,
    }, { storeId })
    return
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscriptionId = stripeId(object)
    await updateStore({
      stripe_customer_id: stripeId(object.customer),
      stripe_subscription_id: subscriptionId,
      stripe_subscription_status: event.type === 'customer.subscription.deleted' ? 'canceled' : String(object.status ?? 'unknown'),
    }, {
      storeId: metadataStoreId(object),
      subscriptionId,
      customerId: stripeId(object.customer),
    })
    return
  }

  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const parent = object.parent && typeof object.parent === 'object' ? object.parent as StripeRecord : null
    const subscriptionDetails = parent?.subscription_details && typeof parent.subscription_details === 'object'
      ? parent.subscription_details as StripeRecord
      : null
    await updateStore({
      stripe_subscription_status: event.type === 'invoice.paid' ? 'active' : 'past_due',
    }, {
      storeId: metadataStoreId(object),
      subscriptionId: stripeId(subscriptionDetails?.subscription ?? object.subscription),
      customerId: stripeId(object.customer),
    })
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let event: Stripe.Event
  try {
    event = await verifyStripeEvent(request, 'STRIPE_WEBHOOK_SECRET')
  } catch (error) {
    console.error('Stripe webhooki kontroll ebaõnnestus.', error)
    return json({ error: 'Invalid Stripe signature' }, 400)
  }

  try {
    if (!await claimEvent(event, 'account')) return json({ received: true, duplicate: true })
    await handleEvent(event)
    await completeEvent(event.id)
    return json({ received: true })
  } catch (error) {
    await releaseEvent(event.id)
    console.error(`Stripe webhook ${event.id} ebaõnnestus.`, error)
    return json({ error: 'Webhook processing failed' }, 500)
  }
})
