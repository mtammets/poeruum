import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'
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
  } catch {
    return configured
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sisselogimine on nõutud.' }, 401)
    const supabaseUrl = requiredEnv('SUPABASE_URL')
    const userClient = createClient(supabaseUrl, requiredEnv('POERUUM_SUPABASE_PUBLISHABLE_KEY'), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)
    const rateLimit = await checkRateLimit(request, 'billing-portal', 10, 600, user.id)
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retry_after_seconds, corsHeaders)

    const admin = createClient(supabaseUrl, requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: store, error: storeError } = await admin.from('stores')
      .select('id,stripe_customer_id,stripe_billing_mode')
      .eq('owner_id', user.id)
      .order('created_at')
      .limit(1)
      .maybeSingle()
    if (storeError) throw storeError
    if (!store?.stripe_customer_id) return json({ error: 'Stripe’i arvelduskontot ei leitud.' }, 404)

    const body = await request.json().catch(() => ({})) as { returnUrl?: string }
    const stripeSecretKey = requiredEnv('STRIPE_SECRET_KEY')
    const stripeMode = assertStripeMode(stripeSecretKey)
    assertStoredStripeMode(store.stripe_billing_mode, stripeMode, 'Poe Stripe Billing')
    const appUrl = returnBase(
      requiredEnv('APP_URL').replace(/\/$/, ''),
      body.returnUrl,
      stripeMode === 'test',
    )
    const session = await new Stripe(stripeSecretKey).billingPortal.sessions.create({
      customer: store.stripe_customer_id,
      return_url: `${appUrl}/?billing=manage`,
    })
    return json({ url: session.url })
  } catch (error) {
    await captureEdgeError('stripe-billing-portal', error)
    console.error('Stripe’i arveldusportaali avamine ebaõnnestus.', error)
    return json({ error: 'Arveldusportaali avamine ebaõnnestus. Palun proovi uuesti.' }, 500)
  }
})
