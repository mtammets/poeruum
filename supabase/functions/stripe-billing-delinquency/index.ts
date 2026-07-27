import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { sendBillingEmail, type BillingEmailStore } from '../_shared/billing-email.ts'
import { captureEdgeError } from '../_shared/security.ts'
import { assertStoredStripeMode, assertStripeMode } from '../_shared/stripe-mode.ts'

type DelinquentStore = BillingEmailStore & {
  pricing_plan: 'fixed' | 'flexible'
  stripe_subscription_id: string | null
  stripe_subscription_status: string | null
  stripe_billing_mode: 'test' | 'live' | null
  billing_delinquent_at: string | null
  billing_failure_notified_at: string | null
  billing_grace_reminder_sent_at: string | null
  billing_downgraded_at: string | null
  billing_downgrade_notified_at: string | null
}

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const clearRecoveredBilling = async (admin: SupabaseClient, storeId: string, status: string) => {
  const { error } = await admin.from('stores').update({
    stripe_subscription_status: status,
    billing_delinquent_at: null,
    billing_grace_ends_at: null,
    billing_last_failed_invoice_id: null,
    billing_last_failed_invoice_url: null,
    billing_failure_notified_at: null,
    billing_grace_reminder_sent_at: null,
    billing_downgraded_at: null,
    billing_downgrade_notified_at: null,
  }).eq('id', storeId)
  if (error) throw error
}

const sendMissingNotification = async (
  admin: SupabaseClient,
  store: DelinquentStore,
  kind: 'payment_failed' | 'grace_reminder' | 'downgraded',
  column: 'billing_failure_notified_at' | 'billing_grace_reminder_sent_at' | 'billing_downgrade_notified_at',
) => {
  await sendBillingEmail(admin, store, kind)
  const { error } = await admin.from('stores').update({ [column]: new Date().toISOString() })
    .eq('id', store.id)
    .is(column, null)
  if (error) throw error
}

const downgradeStore = async (
  admin: SupabaseClient,
  stripe: Stripe,
  store: DelinquentStore,
  subscriptionStatus: string | null,
) => {
  if (store.stripe_subscription_id && subscriptionStatus !== 'canceled') {
    await stripe.subscriptions.cancel(store.stripe_subscription_id, {
      invoice_now: false,
      prorate: false,
    })
  }
  if (store.billing_last_failed_invoice_id) {
    const invoice = await stripe.invoices.retrieve(store.billing_last_failed_invoice_id)
    if (invoice.status === 'open') await stripe.invoices.voidInvoice(invoice.id)
  }

  const downgradedAt = new Date().toISOString()
  const emailStore = { ...store, billing_last_failed_invoice_url: null }
  const { error } = await admin.from('stores').update({
    pricing_plan: 'flexible',
    stripe_subscription_status: 'canceled',
    billing_delinquent_at: null,
    billing_grace_ends_at: null,
    billing_last_failed_invoice_url: null,
    billing_failure_notified_at: null,
    billing_grace_reminder_sent_at: null,
    billing_downgraded_at: downgradedAt,
    billing_downgrade_notified_at: null,
  }).eq('id', store.id)
  if (error) throw error
  await sendMissingNotification(admin, {
    ...emailStore,
    pricing_plan: 'flexible',
    stripe_subscription_status: 'canceled',
    billing_delinquent_at: null,
    billing_grace_ends_at: null,
    billing_failure_notified_at: null,
    billing_grace_reminder_sent_at: null,
    billing_downgraded_at: downgradedAt,
    billing_downgrade_notified_at: null,
  }, 'downgraded', 'billing_downgrade_notified_at')
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (request.headers.get('Authorization') !== `Bearer ${requiredEnv('ONBOARDING_CRON_SECRET')}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const admin = createClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('POERUUM_SUPABASE_SECRET_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const stripeSecretKey = requiredEnv('STRIPE_SECRET_KEY')
  const stripeMode = assertStripeMode(stripeSecretKey)
  const stripe = new Stripe(stripeSecretKey)
  const columns = [
    'id', 'owner_id', 'name', 'pricing_plan', 'stripe_subscription_id', 'stripe_subscription_status',
    'stripe_billing_mode', 'billing_delinquent_at', 'billing_grace_ends_at',
    'billing_last_failed_invoice_id', 'billing_last_failed_invoice_url',
    'billing_failure_notified_at', 'billing_grace_reminder_sent_at',
    'billing_downgraded_at', 'billing_downgrade_notified_at',
  ].join(',')
  const { data, error } = await admin.from('stores').select(columns)
    .or('billing_delinquent_at.not.is.null,and(billing_downgraded_at.not.is.null,billing_downgrade_notified_at.is.null)')
    .order('billing_grace_ends_at', { ascending: true, nullsFirst: false })
    .limit(100)
  if (error) {
    await captureEdgeError('stripe-billing-delinquency', error, {}, 'critical')
    return json({ error: error.message }, 500)
  }

  let recovered = 0
  let reminded = 0
  let downgraded = 0
  const failures: string[] = []
  for (const row of data ?? []) {
    const store = row as unknown as DelinquentStore
    try {
      assertStoredStripeMode(store.stripe_billing_mode, stripeMode, 'Poe Stripe Billing')
      if (!store.billing_delinquent_at && store.billing_downgraded_at && !store.billing_downgrade_notified_at) {
        await sendMissingNotification(admin, store, 'downgraded', 'billing_downgrade_notified_at')
        reminded += 1
        continue
      }

      let subscriptionStatus = store.stripe_subscription_status
      if (store.stripe_subscription_id) {
        const subscription = await stripe.subscriptions.retrieve(store.stripe_subscription_id)
        subscriptionStatus = subscription.status
      }
      if (subscriptionStatus === 'active' || subscriptionStatus === 'trialing') {
        await clearRecoveredBilling(admin, store.id, subscriptionStatus)
        recovered += 1
        continue
      }

      const graceEndsAt = store.billing_grace_ends_at ? new Date(store.billing_grace_ends_at).getTime() : 0
      const now = Date.now()
      if (graceEndsAt > now) {
        if (!store.billing_failure_notified_at) {
          await sendMissingNotification(admin, store, 'payment_failed', 'billing_failure_notified_at')
          reminded += 1
        }
        if (graceEndsAt - now <= 24 * 60 * 60 * 1000 && !store.billing_grace_reminder_sent_at) {
          await sendMissingNotification(admin, store, 'grace_reminder', 'billing_grace_reminder_sent_at')
          reminded += 1
        }
        continue
      }

      await downgradeStore(admin, stripe, store, subscriptionStatus)
      downgraded += 1
    } catch (storeError) {
      failures.push(store.id)
      await captureEdgeError('stripe-billing-delinquency', storeError, { store_id: store.id }, 'critical')
    }
  }

  return json({ processed: data?.length ?? 0, recovered, reminded, downgraded, failures }, failures.length ? 500 : 200)
})
