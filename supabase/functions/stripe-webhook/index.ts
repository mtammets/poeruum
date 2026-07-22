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
import { assertStoredStripeMode } from '../_shared/stripe-mode.ts'

type StripeRecord = Record<string, unknown>

type StoreLookup = {
  id: string
  name: string
}

const unixDate = (value: unknown) => new Date((typeof value === 'number' ? value : Math.floor(Date.now() / 1000)) * 1000).toISOString()

const findStore = async (filters: { storeId?: string | null; customerId?: string | null; subscriptionId?: string | null; connectedAccountId?: string | null }) => {
  const admin = getAdminClient()
  let query = admin.from('stores').select('id,name').limit(1)
  if (filters.storeId) query = query.eq('id', filters.storeId)
  else if (filters.subscriptionId) query = query.eq('stripe_subscription_id', filters.subscriptionId)
  else if (filters.customerId) query = query.eq('stripe_customer_id', filters.customerId)
  else if (filters.connectedAccountId) query = query.eq('stripe_account_id', filters.connectedAccountId)
  else return null
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data as StoreLookup | null
}

const recordRevenue = async (input: {
  event: Stripe.Event
  objectId: string | null
  store: StoreLookup | null
  kind: 'subscription' | 'transaction_fee' | 'transaction_fee_refund'
  amountCents: number
  currency: string
  description: string
  metadata?: Record<string, unknown>
}) => {
  if (!input.amountCents) return
  const { error } = await getAdminClient().from('revenue_events').upsert({
    provider: 'stripe',
    provider_event_id: input.event.id,
    provider_object_id: input.objectId,
    store_id: input.store?.id ?? null,
    kind: input.kind,
    amount_cents: input.amountCents,
    currency: input.currency.toLowerCase(),
    description: input.description,
    occurred_at: unixDate(input.event.created),
    metadata: { stripe_event_type: input.event.type, livemode: input.event.livemode, ...input.metadata },
  }, { onConflict: 'provider,provider_event_id', ignoreDuplicates: true })
  if (error) throw error
}

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

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const storeId = metadataStoreId(object) ?? (typeof object.client_reference_id === 'string' ? object.client_reference_id : null)
    if (object.mode === 'subscription') {
      await updateStore({
        pricing_plan: 'fixed',
        stripe_billing_mode: event.livemode ? 'live' : 'test',
        ...(object.payment_status === 'no_payment_required' ? { trial_started_at: unixDate(event.created) } : {}),
        stripe_customer_id: stripeId(object.customer),
        stripe_subscription_id: stripeId(object.subscription),
        stripe_subscription_status: object.payment_status === 'paid' ? 'active' : 'trialing',
      }, { storeId })
    } else if (object.mode === 'payment') {
      const orderId = object.metadata && typeof object.metadata === 'object' && 'order_id' in object.metadata
        ? String(object.metadata.order_id)
        : null
      if (orderId && (object.payment_status === 'paid' || event.type === 'checkout.session.async_payment_succeeded')) {
        const { data: orderMode, error: modeError } = await getAdminClient().from('orders').select('stripe_mode').eq('id', orderId).maybeSingle()
        if (modeError) throw modeError
        assertStoredStripeMode(orderMode?.stripe_mode, event.livemode ? 'live' : 'test', 'Tellimuse makse')
        const { error } = await getAdminClient().rpc('complete_stripe_order', {
          target_order_id: orderId,
          checkout_session_id: stripeId(object),
          payment_intent_id: stripeId(object.payment_intent),
        })
        if (error) throw error
      } else if (orderId && object.payment_status === 'unpaid') {
        // Some bank methods finish asynchronously after Checkout itself is complete.
        // Keep their goods reserved until Stripe sends the final succeeded/failed event.
        const { error } = await getAdminClient().from('orders').update({
          reservation_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }).eq('id', orderId).eq('payment_status', 'pending')
        if (error) throw error
      }
    }
    return
  }

  if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
    const orderId = object.metadata && typeof object.metadata === 'object' && 'order_id' in object.metadata
      ? String(object.metadata.order_id)
      : null
    if (orderId) {
      const { data: orderMode, error: modeError } = await getAdminClient().from('orders').select('stripe_mode').eq('id', orderId).maybeSingle()
      if (modeError) throw modeError
      assertStoredStripeMode(orderMode?.stripe_mode, event.livemode ? 'live' : 'test', 'Tellimuse makse')
      const { error } = await getAdminClient().rpc('release_stripe_order', { target_order_id: orderId })
      if (error) throw error
    }
    return
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscriptionId = stripeId(object)
    await updateStore({
      ...(event.type === 'customer.subscription.deleted' ? { pricing_plan: 'flexible' } : {}),
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
    if (event.type === 'invoice.paid') {
      const store = await findStore({
        storeId: metadataStoreId(object),
        subscriptionId: stripeId(subscriptionDetails?.subscription ?? object.subscription),
        customerId: stripeId(object.customer),
      })
      const amountPaid = typeof object.subtotal_excluding_tax === 'number'
        ? object.subtotal_excluding_tax
        : typeof object.amount_paid === 'number' ? object.amount_paid : 0
      await recordRevenue({
        event,
        objectId: stripeId(object),
        store,
        kind: 'subscription',
        amountCents: amountPaid,
        currency: typeof object.currency === 'string' ? object.currency : 'eur',
        description: 'Kindla paketi kuutasu',
        metadata: { billing_reason: object.billing_reason ?? null },
      })
    }
    return
  }

  if (event.type === 'application_fee.created') {
    const store = await findStore({ connectedAccountId: stripeId(object.account) })
    await recordRevenue({
      event,
      objectId: stripeId(object),
      store,
      kind: 'transaction_fee',
      amountCents: typeof object.amount === 'number' ? object.amount : 0,
      currency: typeof object.currency === 'string' ? object.currency : 'eur',
      description: '4% müügitasu',
      metadata: { charge_id: stripeId(object.charge) },
    })
    return
  }

  if (event.type === 'application_fee.refunded') {
    const feeId = stripeId(object)
    const store = await findStore({ connectedAccountId: stripeId(object.account) })
    const refundedCents = typeof object.amount_refunded === 'number' ? object.amount_refunded : 0
    const { data: previous, error } = await getAdminClient().from('revenue_events')
      .select('amount_cents')
      .eq('provider', 'stripe')
      .eq('provider_object_id', feeId ?? '')
      .eq('kind', 'transaction_fee_refund')
    if (error) throw error
    const alreadyRecorded = (previous ?? []).reduce((sum, row) => sum + Math.abs(Number(row.amount_cents)), 0)
    const refundDelta = Math.max(0, refundedCents - alreadyRecorded)
    await recordRevenue({
      event,
      objectId: feeId,
      store,
      kind: 'transaction_fee_refund',
      amountCents: -refundDelta,
      currency: typeof object.currency === 'string' ? object.currency : 'eur',
      description: 'Tagastatud müügitasu',
      metadata: { charge_id: stripeId(object.charge) },
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
