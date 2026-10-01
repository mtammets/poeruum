import Stripe from 'npm:stripe@^22'
import { captureEdgeError } from '../_shared/security.ts'
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
import { handleStorePaymentEvent } from '../_shared/stripe-store-events.ts'
import { sendBillingEmail, type BillingEmailStore } from '../_shared/billing-email.ts'
import { platformBillingBuyer, subscriptionInvoiceAmounts } from '../../../shared/platform-billing.ts'
import { prepareSubscriptionInvoice } from '../_shared/platform-billing.ts'

type StripeRecord = Record<string, unknown>

type StoreLookup = {
  id: string
  name: string
  owner_id: string | null
  billing_delinquent_at: string | null
  billing_grace_ends_at: string | null
  billing_last_failed_invoice_id: string | null
  billing_last_failed_invoice_url: string | null
  billing_downgraded_at: string | null
  billing_downgrade_notified_at: string | null
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
  let query = admin.from('stores').select([
    'id', 'name', 'owner_id', 'billing_delinquent_at', 'billing_grace_ends_at',
    'billing_last_failed_invoice_id', 'billing_last_failed_invoice_url',
    'billing_downgraded_at', 'billing_downgrade_notified_at',
  ].join(',')).limit(1)
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
  store: Pick<StoreLookup, 'id' | 'name'> | null
  kind: 'subscription' | 'transaction_fee' | 'transaction_fee_refund'
  amountCents: number
  currency: string
  description: string
  metadata?: Record<string, unknown>
  revenueKey?: string
  occurredAt?: number
}) => {
  if (!input.amountCents) return
  const { error } = await getAdminClient().from('revenue_events').upsert({
    provider: 'stripe',
    provider_event_id: input.revenueKey ?? input.event.id,
    provider_object_id: input.objectId,
    store_id: input.store?.id ?? null,
    kind: input.kind,
    amount_cents: input.amountCents,
    currency: input.currency.toLowerCase(),
    description: input.description,
    occurred_at: unixDate(input.occurredAt ?? input.event.created),
    metadata: { stripe_event_type: input.event.type, livemode: input.event.livemode, ...input.metadata },
  }, { onConflict: 'provider,provider_event_id', ignoreDuplicates: true })
  if (error) throw error
}

const subscriptionIdFromInvoice = (invoice: StripeRecord) => {
  const parent = invoice.parent as { subscription_details?: { subscription?: unknown } } | null
  return stripeId(parent?.subscription_details?.subscription ?? invoice.subscription)
}

const recordPaidSubscriptionInvoice = async (invoice: Stripe.Invoice, event: Stripe.Event, store: StoreLookup) => {
  // Credit notes on an unpaid invoice reduce its debt, not collected revenue.
  // When it becomes paid, book the original amount and all issued credits.
  if (invoice.status !== 'paid') return
  const amounts = subscriptionInvoiceAmounts(invoice as unknown as StripeRecord)
  const mode = event.livemode ? 'live' : 'test'
  const paidAt = invoice.status_transitions.paid_at ?? event.created
  await recordRevenue({ event, objectId: invoice.id, store, kind: 'subscription',
    revenueKey: `billing-invoice-paid:${mode}:${invoice.id}`, occurredAt: paidAt,
    amountCents: amounts.net, currency: invoice.currency, description: 'Kindla paketi kuutasu',
    metadata: { billing_reason: invoice.billing_reason, stripe_event_id: event.id,
      net_amount_cents: amounts.net, vat_amount_cents: amounts.vat, gross_amount_cents: amounts.gross,
      amount_paid_cents: invoice.amount_paid, account_tax_ids: invoice.account_tax_ids ?? [] },
  })
  for await (const credit of new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!).creditNotes.list({ invoice: invoice.id, limit: 100 })) {
    if (credit.status !== 'issued') continue
    const creditAmounts = subscriptionInvoiceAmounts(credit as unknown as StripeRecord)
    // Stripe permits voiding only credits on open invoices. Those have never
    // entered this paid-invoice ledger. Stable document keys deduplicate both
    // event redelivery and invoice.paid/credit_note.created arriving in any order.
    await recordRevenue({ event, objectId: credit.id, store, kind: 'subscription',
      revenueKey: `billing-credit-note:${mode}:${credit.id}`, occurredAt: Math.max(paidAt, credit.created),
      amountCents: -creditAmounts.net, currency: invoice.currency, description: 'Kindla paketi kreeditarve',
      metadata: { billing_adjustment: 'credit_note', invoice_id: invoice.id, stripe_event_id: event.id,
        net_amount_cents: -creditAmounts.net, vat_amount_cents: -creditAmounts.vat, gross_amount_cents: -creditAmounts.gross },
    })
  }
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

const clearedDelinquency = {
  billing_delinquent_at: null,
  billing_grace_ends_at: null,
  billing_last_failed_invoice_id: null,
  billing_last_failed_invoice_url: null,
  billing_failure_notified_at: null,
  billing_grace_reminder_sent_at: null,
  billing_downgraded_at: null,
  billing_downgrade_notified_at: null,
}

const markStoreDelinquent = async (input: {
  storeId?: string | null
  customerId?: string | null
  subscriptionId?: string | null
  status: string
  invoiceId?: string | null
  invoiceUrl?: string | null
}) => {
  const store = await findStore(input)
  if (!store) return
  const isNewEpisode = !store.billing_delinquent_at
  const delinquentAt = store.billing_delinquent_at ?? new Date().toISOString()
  const graceEndsAt = store.billing_grace_ends_at
    ?? new Date(new Date(delinquentAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const nextStore: BillingEmailStore = {
    ...store,
    billing_grace_ends_at: graceEndsAt,
    billing_last_failed_invoice_id: input.invoiceId ?? store.billing_last_failed_invoice_id,
    billing_last_failed_invoice_url: input.invoiceUrl ?? store.billing_last_failed_invoice_url,
  }
  await updateStore({
    stripe_subscription_status: input.status,
    billing_delinquent_at: delinquentAt,
    billing_grace_ends_at: graceEndsAt,
    billing_last_failed_invoice_id: nextStore.billing_last_failed_invoice_id,
    billing_last_failed_invoice_url: nextStore.billing_last_failed_invoice_url,
    ...(isNewEpisode ? {
      billing_failure_notified_at: null,
      billing_grace_reminder_sent_at: null,
      billing_downgraded_at: null,
      billing_downgrade_notified_at: null,
    } : {}),
  }, { storeId: store.id })

  if (isNewEpisode) {
    try {
      await sendBillingEmail(getAdminClient(), nextStore, 'payment_failed')
      await updateStore({ billing_failure_notified_at: new Date().toISOString() }, { storeId: store.id })
    } catch (error) {
      // The scheduled delinquency worker retries unsent billing notifications.
      console.error(`Poe ${store.id} maksevea teavituse saatmine ebaõnnestus.`, error)
    }
  }
}

const handleEvent = async (event: Stripe.Event) => {
  const object = event.data.object as unknown as StripeRecord

  if (await handleStorePaymentEvent(event)) return

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const storeId = metadataStoreId(object) ?? (typeof object.client_reference_id === 'string' ? object.client_reference_id : null)
    if (object.mode === 'subscription') {
      const subscription = await getSubscriptionState(stripeId(object.subscription))
      await updateStore({
        pricing_plan: 'fixed',
        stripe_billing_mode: event.livemode ? 'live' : 'test',
        ...clearedDelinquency,
        ...(subscription?.trialStartedAt ? { trial_started_at: subscription.trialStartedAt } : {}),
        stripe_customer_id: stripeId(object.customer),
        stripe_subscription_id: subscription?.id ?? stripeId(object.subscription),
        stripe_subscription_status: subscription?.status ?? (object.payment_status === 'paid' ? 'active' : 'trialing'),
      }, { storeId })
    }
    return
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscriptionId = stripeId(object)
    const status = event.type === 'customer.subscription.deleted' ? 'canceled' : String(object.status ?? 'unknown')
    if (event.type === 'customer.subscription.deleted') {
      const store = await findStore({
        storeId: metadataStoreId(object),
        subscriptionId,
        customerId: stripeId(object.customer),
      })
      const wasDowngradedForNonpayment = Boolean(store?.billing_delinquent_at || store?.billing_downgraded_at)
      await updateStore({
        pricing_plan: 'flexible',
        ...clearedDelinquency,
        ...(wasDowngradedForNonpayment ? {
          billing_downgraded_at: store?.billing_downgraded_at ?? new Date().toISOString(),
          billing_downgrade_notified_at: store?.billing_downgrade_notified_at,
        } : {}),
        stripe_customer_id: stripeId(object.customer),
        stripe_subscription_id: subscriptionId,
        stripe_subscription_status: status,
      }, {
        storeId: metadataStoreId(object),
        subscriptionId,
        customerId: stripeId(object.customer),
      })
      return
    }
    if (status === 'past_due' || status === 'unpaid') {
      await markStoreDelinquent({
        storeId: metadataStoreId(object),
        subscriptionId,
        customerId: stripeId(object.customer),
        status,
      })
      return
    }
    await updateStore({
      ...(['active', 'trialing', 'canceled'].includes(status) ? clearedDelinquency : {}),
      stripe_customer_id: stripeId(object.customer),
      stripe_subscription_id: subscriptionId,
      stripe_subscription_status: status,
    }, {
      storeId: metadataStoreId(object),
      subscriptionId,
      customerId: stripeId(object.customer),
    })
    return
  }

  if (event.type === 'invoice.created' || event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const subscriptionId = subscriptionIdFromInvoice(object)
    // Other applications can share this Stripe account. A one-off invoice must
    // never activate a Poeruum plan or enter its subscription revenue ledger.
    if (!subscriptionId) return
    const billingStore = await findStore({ subscriptionId }) ?? await findStore({ customerId: stripeId(object.customer) })
    if (!billingStore) return
    if (event.type === 'invoice.created') {
      const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
      const invoiceId = stripeId(object)
      if (!invoiceId) throw new Error('Subscription invoice ID missing')
      const draft = await stripe.invoices.retrieve(invoiceId)
      if (draft.status !== 'draft') return
      const { data: details, error } = await getAdminClient().from('stores').select('settings,stripe_customer_id')
        .eq('id', billingStore.id).single()
      if (error) throw error
      if (!details.stripe_customer_id) throw new Error('Subscription invoice customer missing')
      await prepareSubscriptionInvoice(stripe, {
        invoiceId, storeId: billingStore.id, customerId: details.stripe_customer_id,
        buyer: platformBillingBuyer(details.settings ?? {}, draft.customer_email ?? ''), mode: event.livemode ? 'live' : 'test',
      })
      return
    }
    const subscription = await getSubscriptionState(subscriptionId)
    const subscriptionStatus = subscription?.status ?? (event.type === 'invoice.paid' ? 'active' : 'past_due')
    if (event.type === 'invoice.payment_failed') {
      await markStoreDelinquent({
        storeId: billingStore.id,
        subscriptionId,
        customerId: stripeId(object.customer),
        status: subscriptionStatus,
        invoiceId: stripeId(object),
        invoiceUrl: typeof object.hosted_invoice_url === 'string' ? object.hosted_invoice_url : null,
      })
    } else {
      await updateStore({
        stripe_subscription_status: subscriptionStatus,
        ...(subscriptionStatus === 'active' ? clearedDelinquency : {}),
        ...(subscription?.trialStartedAt ? { trial_started_at: subscription.trialStartedAt } : {}),
      }, {
        storeId: billingStore.id,
        subscriptionId,
        customerId: stripeId(object.customer),
      })
    }
    if (event.type === 'invoice.paid') {
      const invoice = await new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!).invoices.retrieve(stripeId(object)!)
      await recordPaidSubscriptionInvoice(invoice, event, billingStore)
    }
    return
  }

  if (event.type === 'credit_note.created' || event.type === 'credit_note.voided') {
    const invoiceId = stripeId(object.invoice)
    if (!invoiceId) return
    const invoice = await new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!).invoices.retrieve(invoiceId)
    const subscriptionId = subscriptionIdFromInvoice(invoice as unknown as StripeRecord)
    if (!subscriptionId) return
    const store = await findStore({ subscriptionId }) ?? await findStore({ customerId: stripeId(invoice.customer) })
    if (!store) return
    await recordPaidSubscriptionInvoice(invoice, event, store)
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

  let token: string | undefined
  try {
    const claim = await claimEvent(event, 'account')
    if (claim.state === 'processed') return json({ received: true, duplicate: true })
    if (claim.state === 'busy') return json({ error: 'Webhook processing in progress' }, 503)
    token = claim.token!
    await handleEvent(event)
    await completeEvent(event.id, token)
    return json({ received: true })
  } catch (error) {
    if (token) await releaseEvent(event.id, token, error)
    await captureEdgeError('stripe-webhook', error, { event_type: event.type }, 'critical')
    console.error(`Stripe webhook ${event.id} ebaõnnestus.`, error)
    return json({
      error: 'Webhook processing failed',
      ...(!event.livemode && error instanceof Error ? { detail: error.message } : {}),
    }, 500)
  }
})
