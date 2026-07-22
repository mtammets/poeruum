import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { assertStoredStripeMode, assertStripeMode } from '../_shared/stripe-mode.ts'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sisselogimine on nõutud.' }, 401)
    const supabaseUrl = requiredEnv('SUPABASE_URL')
    const userClient = createClient(supabaseUrl, requiredEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)
    const admin = createClient(supabaseUrl, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: store, error: storeError } = await admin.from('stores').select('*').eq('owner_id', user.id).order('created_at').limit(1).maybeSingle()
    if (storeError) throw storeError
    if (!store) return json({ error: 'Poodi ei leitud.' }, 404)
    if (!store.stripe_subscription_id || !['active', 'trialing', 'past_due'].includes(String(store.stripe_subscription_status))) {
      const { error } = await admin.from('stores').update({ pricing_plan: 'flexible', stripe_subscription_status: null }).eq('id', store.id)
      if (error) throw error
      return json({ effectiveImmediately: true })
    }
    const stripeSecretKey = requiredEnv('STRIPE_SECRET_KEY')
    const stripeMode = assertStripeMode(stripeSecretKey)
    assertStoredStripeMode(store.stripe_billing_mode, stripeMode, 'Poe Stripe Billing')
    const stripe = new Stripe(stripeSecretKey)
    const subscription = await stripe.subscriptions.update(store.stripe_subscription_id, { cancel_at_period_end: true })
    return json({ effectiveImmediately: false, cancelAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null })
  } catch (error) {
    console.error('Kindla paketi lõpetamine ebaõnnestus.', error)
    return json({ error: error instanceof Error ? error.message : 'Paketi muutmine ebaõnnestus.' }, 500)
  }
})
