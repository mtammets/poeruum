import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { assertStoredStripeMode, assertStripeMode } from '../_shared/stripe-mode.ts'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const env = (key: string) => { const value = Deno.env.get(key)?.trim(); if (!value) throw new Error(`Missing ${key}`); return value }

// This endpoint grants a short-lived, owner-scoped Stripe UI session. Money
// movement, schedule changes and their confirmations are handled by Stripe.
// Opening this view never edits an account, its schedule or its balance.
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Logi sisse.' }, 401)
    const options = { auth: { persistSession: false, autoRefreshToken: false } }
    const userClient = createClient(env('SUPABASE_URL'), env('POERUUM_SUPABASE_PUBLISHABLE_KEY'), { ...options, global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)
    const limit = await checkRateLimit(request, 'stripe-payouts', 15, 60, user.id)
    if (!limit.allowed) return rateLimitResponse(limit.retry_after_seconds, headers)
    const body = await request.json().catch(() => null)
    if (typeof body?.storeId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.storeId)) return json({ error: 'Poe tunnus on puudulik.' }, 400)
    const admin = createClient(env('SUPABASE_URL'), env('POERUUM_SUPABASE_SECRET_KEY'), options)
    const { data: store, error } = await admin.from('stores').select('id,stripe_account_id,stripe_account_mode').eq('id', body.storeId).eq('owner_id', user.id).maybeSingle()
    if (error) throw error
    if (!store) return json({ error: 'Poodi ei leitud.' }, 404)
    if (!store.stripe_account_id) return json({ error: 'Ühenda esmalt Stripe’i konto.' }, 409)
    const secret = env('STRIPE_SECRET_KEY'), mode = assertStripeMode(secret)
    if (!store.stripe_account_mode) return json({ error: 'Stripe’i konto ühendus vajab kontrolli. Võta ühendust toega.' }, 409)
    assertStoredStripeMode(store.stripe_account_mode, mode, 'Poe Stripe’i konto')
    const stripe = new Stripe(secret, { timeout: 10_000, maxNetworkRetries: 1 })
    const account = await stripe.accounts.retrieve(store.stripe_account_id)
    if ('deleted' in account && account.deleted) return json({ error: 'Stripe’i konto pole enam saadaval.' }, 409)
    if (account.controller?.is_controller !== true) return json({ kind: 'dashboard', dashboardUrl: 'https://dashboard.stripe.com/payouts', mode })
    // Enable only after the platform's EUR 1% + 0 EUR Instant Payout pricing
    // rule has been enabled and verified. Stripe collects and discloses this
    // application fee atomically; we do not debit balances separately.
    const instantPayoutsEnabled = Deno.env.get('STRIPE_INSTANT_PAYOUTS_ENABLED') === 'true'
      && account.controller.fees?.payer === 'application' && account.default_currency === 'eur'
    const session = await stripe.accountSessions.create({
      account: account.id,
      components: {
        payouts: { enabled: true, features: {
          edit_payout_schedule: true,
          standard_payouts: true,
          instant_payouts: instantPayoutsEnabled,
          // Stripe requires collection enabled to enforce its authentication.
          external_account_collection: true,
          disable_stripe_user_authentication: false,
        } },
      },
    })
    return json({ kind: 'embedded', clientSecret: session.client_secret, mode, instantPayoutsEnabled })
  } catch (error) {
    await captureEdgeError('stripe-payouts', error)
    return json({ error: 'Väljamaksete laadimine ebaõnnestus. Proovi uuesti.' }, 500)
  }
})
