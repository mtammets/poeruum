import Stripe from 'npm:stripe@^22'
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
import { sendPaidOrderEmails } from '../_shared/order-email.ts'

type StripeRecord = Record<string, unknown>

type StoreLookup = {
  id: string
  name: string
}

const unixDate = (value: unknown) => new Date((typeof value === 'number' ? value : Math.floor(Date.now() / 1000)) * 1000).toISOString()

const getSubscriptionState = async (subscriptionId: string | null) => {
  if (!subscriptionId) return null
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secretKey) throw new Error('Puudub STRIPE_SECRET_KEY.')
  const subscription = await new Stripe(secretKey).subscriptions.retrieve(subscriptionId)
  return {
    id: subscription.id,
    status: subscription.status,
    trialStartedAt: subscription.trial_start ? unixDate(subscription.trial_start) : null,
  }
}

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

const completeStorePayment = async (event: Stripe.Event, object: StripeRecord, orderId: string, storeId: string | null) => {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secretKey) throw new Error('Puudub STRIPE_SECRET_KEY.')
  const stripe = new Stripe(secretKey)
  const paymentIntentId = stripeId(object.payment_intent)
  if (!paymentIntentId) throw new Error('Makse PaymentIntent puudub.')

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge.balance_transaction'],
  })
  let charge = paymentIntent.latest_charge && typeof paymentIntent.latest_charge === 'object'
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge ? await stripe.charges.retrieve(paymentIntent.latest_charge, { expand: ['balance_transaction'] }) : null
  if (!charge || charge.status !== 'succeeded') throw new Error('Stripe’i kinnitatud maksekanne puudub.')
  let balanceTransaction = charge.balance_transaction && typeof charge.balance_transaction === 'object'
    ? charge.balance_transaction
    : charge.balance_transaction ? await stripe.balanceTransactions.retrieve(charge.balance_transaction) : null
  for (let attempt = 0; !balanceTransaction && attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    charge = await stripe.charges.retrieve(charge.id, { expand: ['balance_transaction'] })
    balanceTransaction = charge.balance_transaction && typeof charge.balance_transaction === 'object'
      ? charge.balance_transaction
      : charge.balance_transaction ? await stripe.balanceTransactions.retrieve(charge.balance_transaction) : null
  }
  if (!balanceTransaction) throw new Error('Stripe’i maksetasu pole veel saadaval.')

  const admin = getAdminClient()
  const { data: order, error: orderError } = await admin.from('orders')
    .select('id,store_id,stripe_mode,stripe_transfer_id')
    .eq('id', orderId)
    .maybeSingle()
  if (orderError) throw orderError
  if (!order) throw new Error('Tellimust ei leitud.')
  assertStoredStripeMode(order.stripe_mode, event.livemode ? 'live' : 'test', 'Tellimuse makse')

  const resolvedStoreId = storeId ?? String(order.store_id)
  const { data: store, error: storeError } = await admin.from('stores')
    .select('id,name,stripe_account_id')
    .eq('id', resolvedStoreId)
    .maybeSingle()
  if (storeError) throw storeError
  if (!store?.stripe_account_id) throw new Error('Müüja Stripe’i konto puudub.')

  const processingFeeCents = Math.max(0, Number(balanceTransaction.fee ?? 0))
  const platformFeeCents = Math.max(0, Math.floor(Number(paymentIntent.metadata.platform_fee_cents ?? 0)))
  const platformFeeNetCents = Math.max(0, Math.floor(Number(paymentIntent.metadata.platform_fee_net_cents ?? platformFeeCents)))
  const platformFeeVatCents = Math.max(0, Math.floor(Number(paymentIntent.metadata.platform_fee_vat_cents ?? 0)))
  if (platformFeeNetCents + platformFeeVatCents !== platformFeeCents) throw new Error('Poeruumi teenustasu käibemaksu jaotus ei klapi.')
  const paidCents = Math.max(0, Number(paymentIntent.amount_received || charge.amount))
  const sellerNetCents = Math.max(0, paidCents - processingFeeCents - platformFeeCents)
  if (sellerNetCents <= 0) throw new Error('Makse summa ei kata Stripe’i ja Poeruumi teenustasusid.')

  const transfer = order.stripe_transfer_id
    ? await stripe.transfers.retrieve(String(order.stripe_transfer_id))
    : await stripe.transfers.create({
      amount: sellerNetCents,
      currency: paymentIntent.currency,
      destination: store.stripe_account_id,
      source_transaction: charge.id,
      transfer_group: `order_${orderId}`,
      description: `Poeruum ${String(object.metadata && typeof object.metadata === 'object' && 'order_number' in object.metadata ? object.metadata.order_number : orderId)}`,
      metadata: { store_id: resolvedStoreId, order_id: orderId, payment_intent_id: paymentIntentId },
    }, { idempotencyKey: `poeruum-order-transfer-${orderId}` })

  const { error: settlementError } = await admin.from('orders').update({
    stripe_transfer_id: transfer.id,
    stripe_processing_fee_cents: processingFeeCents,
    stripe_platform_fee_cents: platformFeeCents,
    stripe_platform_fee_net_cents: platformFeeNetCents,
    stripe_platform_fee_vat_cents: platformFeeVatCents,
    stripe_seller_net_cents: sellerNetCents,
  }).eq('id', orderId)
  if (settlementError) throw settlementError

  const { error: completionError } = await admin.rpc('complete_stripe_order', {
    target_order_id: orderId,
    checkout_session_id: stripeId(object),
    payment_intent_id: paymentIntentId,
  })
  if (completionError) throw completionError

  if (platformFeeCents > 0) {
    await recordRevenue({
      event,
      objectId: transfer.id,
      store: { id: store.id, name: store.name },
      kind: 'transaction_fee',
      amountCents: platformFeeNetCents,
      currency: paymentIntent.currency,
      description: '4% müügitasu + käibemaks',
      metadata: {
        net_amount_cents: platformFeeNetCents,
        vat_amount_cents: platformFeeVatCents,
        gross_amount_cents: platformFeeCents,
        vat_rate: 24,
        payment_intent_id: paymentIntentId,
        stripe_processing_fee_cents: processingFeeCents,
        seller_net_cents: sellerNetCents,
      },
    })
  }
}

const handleEvent = async (event: Stripe.Event) => {
  const object = event.data.object as unknown as StripeRecord

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const storeId = metadataStoreId(object) ?? (typeof object.client_reference_id === 'string' ? object.client_reference_id : null)
    if (object.mode === 'subscription') {
      const subscription = await getSubscriptionState(stripeId(object.subscription))
      await updateStore({
        pricing_plan: 'fixed',
        stripe_billing_mode: event.livemode ? 'live' : 'test',
        ...(subscription?.trialStartedAt ? { trial_started_at: subscription.trialStartedAt } : {}),
        stripe_customer_id: stripeId(object.customer),
        stripe_subscription_id: subscription?.id ?? stripeId(object.subscription),
        stripe_subscription_status: subscription?.status ?? (object.payment_status === 'paid' ? 'active' : 'trialing'),
      }, { storeId })
    } else if (object.mode === 'payment') {
      const orderId = object.metadata && typeof object.metadata === 'object' && 'order_id' in object.metadata
        ? String(object.metadata.order_id)
        : null
      if (orderId && (object.payment_status === 'paid' || event.type === 'checkout.session.async_payment_succeeded')) {
        await completeStorePayment(event, object, orderId, storeId)
        await sendPaidOrderEmails(getAdminClient(), orderId)
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
    const subscriptionId = stripeId(subscriptionDetails?.subscription ?? object.subscription)
    const subscription = await getSubscriptionState(subscriptionId)
    await updateStore({
      stripe_subscription_status: subscription?.status ?? (event.type === 'invoice.paid' ? 'active' : 'past_due'),
      ...(subscription?.trialStartedAt ? { trial_started_at: subscription.trialStartedAt } : {}),
    }, {
      storeId: metadataStoreId(object),
      subscriptionId,
      customerId: stripeId(object.customer),
    })
    if (event.type === 'invoice.paid') {
      const store = await findStore({
        storeId: metadataStoreId(object),
        subscriptionId,
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
    return json({
      error: 'Webhook processing failed',
      ...(!event.livemode && error instanceof Error ? { detail: error.message } : {}),
    }, 500)
  }
})
