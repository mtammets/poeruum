import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'
import { assertStoredStripeMode, assertStripeMode } from '../_shared/stripe-mode.ts'
import { processStoreSettlement } from '../_shared/order-settlement.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
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
    const userClient = createClient(supabaseUrl, requiredEnv('POERUUM_SUPABASE_PUBLISHABLE_KEY'), {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)
    const rateLimit = await checkRateLimit(request, 'order-refund', 10, 3600, user.id)
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retry_after_seconds, corsHeaders)
    const body = await request.json().catch(() => ({})) as { storeId?: string; orderNumber?: string }
    const admin = createClient(supabaseUrl, requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: store, error: storeError } = await admin.from('stores').select('id').eq('id', body.storeId ?? '').eq('owner_id', user.id).maybeSingle()
    if (storeError) throw storeError
    if (!store) return json({ error: 'Tellimuse tagastamiseks puudub õigus.' }, 403)
    const { data: order, error: orderError } = await admin.from('orders').select('*').eq('store_id', store.id).eq('order_number', body.orderNumber ?? '').maybeSingle()
    if (orderError) throw orderError
    if (!order) return json({ error: 'Tellimust ei leitud.' }, 404)
    if (order.payment_status === 'refunded') return json({ refunded: true })
    if (!order.stripe_payment_intent_id || order.payment_status !== 'paid') return json({ error: 'Sellel tellimusel pole tagastatavat Stripe’i makset.' }, 409)

    const stripeSecretKey = requiredEnv('STRIPE_SECRET_KEY')
    const stripeMode = assertStripeMode(stripeSecretKey)
    assertStoredStripeMode(order.stripe_mode, stripeMode, 'Tellimuse makse')
    const stripe = new Stripe(stripeSecretKey, { timeout: 10_000, maxNetworkRetries: 1 })
    const { data: job, error: requestError } = await admin.rpc('request_stripe_order_refund', {
      target_order_id: order.id, mode_value: stripeMode,
    })
    if (requestError) throw requestError
    if (job?.status === 'needs_review') return json({ error: 'Tagastus vajab kontrollimist. Võta ühendust Poeruumi toega.' }, 409)
    if (Deno.env.get('STRIPE_SETTLEMENT_WORKER_ENABLED') !== 'false') {
      await processStoreSettlement({
        admin, stripe,
        onError: (error, orderId, status) => captureEdgeError('stripe-order-settlements', error, { order_id: orderId, settlement_status: status }, 'critical'),
      }, stripeMode, order.id)
    }
    const { data: updated, error: readError } = await admin.from('orders')
      .select('payment_status,stripe_refund_status').eq('id', order.id).single()
    if (readError) throw readError
    if (updated.stripe_refund_status === 'failed') {
      return json({ error: 'Tagastus vajab kontrollimist. Võta ühendust Poeruumi toega.' }, 409)
    }
    const refunded = updated.payment_status === 'refunded'
    return json({ refunded, pending: !refunded, status: updated.stripe_refund_status })

  } catch (error) {
    await captureEdgeError('stripe-refund-order', error)
    console.error('Stripe’i tagastus ebaõnnestus.', error)
    return json({ error: 'Tagastus ebaõnnestus. Palun proovi uuesti.' }, 500)
  }
})
