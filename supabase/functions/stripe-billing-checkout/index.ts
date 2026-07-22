import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { assertStoredStripeMode, assertStripeMode } from '../_shared/stripe-mode.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}
const returnBase = (configured: string, requested: string | undefined, testMode: boolean) => {
  try {
    if (!requested) return configured
    const url = new URL(requested)
    const isPrivateTestHost = testMode && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'
      || /^10\./.test(url.hostname) || /^192\.168\./.test(url.hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname))
    return url.origin === new URL(configured).origin || isPrivateTestHost ? url.origin : configured
  } catch { return configured }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sisselogimine on nõutud.' }, 401)
    const supabaseUrl = requiredEnv('SUPABASE_URL')
    const publicKey = requiredEnv('SUPABASE_ANON_KEY')
    const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    const userClient = createClient(supabaseUrl, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: store, error: storeError } = await admin.from('stores').select('*').eq('owner_id', user.id).order('created_at').limit(1).maybeSingle()
    if (storeError) throw storeError
    if (!store) return json({ error: 'Pood tuleb enne paketi valimist salvestada.' }, 404)
    if (store.stripe_subscription_id && ['active', 'trialing'].includes(String(store.stripe_subscription_status))) {
      return json({ error: 'Kindel pakett on juba aktiivne.' }, 409)
    }

    const body = await request.json().catch(() => ({})) as { returnUrl?: string; checkoutRequestId?: string }
    const checkoutRequestId = String(body.checkoutRequestId ?? '').trim()
    if (checkoutRequestId.length < 16 || checkoutRequestId.length > 100) return json({ error: 'Maksepäringu ID puudub.' }, 400)
    const stripeSecretKey = requiredEnv('STRIPE_SECRET_KEY')
    const stripeMode = assertStripeMode(stripeSecretKey)
    assertStoredStripeMode(store.stripe_billing_mode, stripeMode, 'Poe Stripe Billing')
    const stripe = new Stripe(stripeSecretKey)
    const appUrl = returnBase(requiredEnv('APP_URL').replace(/\/$/, ''), body.returnUrl, stripeSecretKey.includes('_test_'))
    const fixedPlanTaxRateId = Deno.env.get('STRIPE_FIXED_PLAN_TAX_RATE_ID')?.trim()
    const fixedPlanPriceId = requiredEnv('STRIPE_FIXED_PLAN_PRICE_ID')
    const price = await stripe.prices.retrieve(fixedPlanPriceId)
    if (price.livemode !== (stripeMode === 'live') || !price.active || price.currency !== 'eur' || price.type !== 'recurring'
      || price.unit_amount !== 2900 || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1) {
      throw new Error('Kindla paketi Stripe Price ei vasta aktiivsele režiimile või paketile.')
    }
    if (fixedPlanTaxRateId) {
      const taxRate = await stripe.taxRates.retrieve(fixedPlanTaxRateId)
      if (taxRate.livemode !== (stripeMode === 'live') || !taxRate.active || taxRate.percentage !== 24
        || taxRate.inclusive || taxRate.country !== 'EE') throw new Error('Stripe’i käibemaksumäär ei vasta Eesti 24% standardmäärale.')
    }
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      client_reference_id: store.id,
      customer_email: store.stripe_customer_id ? undefined : user.email,
      customer: store.stripe_customer_id ?? undefined,
      line_items: [{ price: fixedPlanPriceId, quantity: 1, ...(fixedPlanTaxRateId ? { tax_rates: [fixedPlanTaxRateId] } : {}) }],
      allow_promotion_codes: false,
      success_url: `${appUrl}/?billing=success`,
      cancel_url: `${appUrl}/?billing=cancelled`,
      metadata: { store_id: store.id, stripe_mode: stripeMode },
      subscription_data: {
        trial_period_days: store.trial_started_at ? undefined : 30,
        metadata: { store_id: store.id, stripe_mode: stripeMode },
      },
    }
    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: `poeruum-billing-${store.id}-${checkoutRequestId}`,
    })
    if (!session.url) throw new Error('Stripe ei tagastanud arvelduslehe aadressi.')
    return json({ url: session.url })
  } catch (error) {
    console.error('Stripe Billingu makse algatamine ebaõnnestus.', error)
    return json({ error: error instanceof Error ? error.message : 'Arvelduse algatamine ebaõnnestus.' }, 500)
  }
})
