import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { assertStripeMode, assertStoredStripeMode } from '../_shared/stripe-mode.ts'
import { syncSellerPaymentCheck } from '../_shared/seller-payment-check.ts'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
const env = (name: string) => { const value = Deno.env.get(name)?.trim(); if (!value) throw new Error(`Missing ${name}`); return value }
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Logi sisse.' }, 401)
    const options = { auth: { persistSession: false, autoRefreshToken: false } }
    const userClient = createClient(env('SUPABASE_URL'), env('POERUUM_SUPABASE_PUBLISHABLE_KEY'), { ...options, global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return json({ error: 'Logi sisse.' }, 401)
    if (user.app_metadata?.role !== 'admin') return json({ error: 'Administraatori õigus puudub.' }, 403)
    const limit = await checkRateLimit(request, 'payment-review', 20, 60, user.id)
    if (!limit.allowed) return rateLimitResponse(limit.retry_after_seconds, headers)
    const admin = createClient(env('SUPABASE_URL'), env('POERUUM_SUPABASE_SECRET_KEY'), options)
    const input = await request.json() as { action?: string; storeId?: string; orderId?: string; bankId?: string; evidence?: string }
    const key = env('STRIPE_SECRET_KEY')
    const mode = assertStripeMode(key)
    if (input.action === 'retry-refund') {
      const { data: order, error } = await admin.from('orders').select('stripe_mode').eq('id', input.orderId ?? '').single()
      if (error) throw error
      assertStoredStripeMode(order.stripe_mode, mode, 'Tellimus')
      const { error: retryError } = await admin.rpc('retry_funded_stripe_refund', { target_order_id: input.orderId })
      if (retryError) throw retryError
      // The durable worker owns the retry; no browser request moves funds.
      return json({ ok: true })
    }
    if (!['refresh-seller', 'approve-seller'].includes(input.action ?? '')) return json({ error: 'Tundmatu toiming.' }, 400)
    const { data: store, error } = await admin.from('stores').select('*').eq('id', input.storeId ?? '').single()
    if (error) throw error
    if (!store.stripe_account_id) return json({ error: 'Stripe’i konto puudub.' }, 409)
    assertStoredStripeMode(store.stripe_account_mode, mode, 'Pood')
    const stripe = new Stripe(key, { timeout: 10_000, maxNetworkRetries: 1 })
    const account = await stripe.accounts.retrieve(store.stripe_account_id)
    if ('deleted' in account && account.deleted) return json({ error: 'Konto on kustutatud.' }, 409)
    await syncSellerPaymentCheck(admin, stripe, store, account)
    if (input.action === 'approve-seller') {
      const { error: approveError } = await admin.rpc('approve_entrepreneur_payout', {
        target_store_id: store.id, bank_id_value: input.bankId ?? '', evidence_value: input.evidence ?? '', admin_id: user.id,
      })
      if (approveError) return json({ error: 'Kontrolli värskeid kontoandmeid ning lisa kontrolli tõend. Konto või müüja andmed võivad olla muutunud.' }, 409)
    }
    return json({ ok: true })
  } catch (error) {
    await captureEdgeError('payment-review', error)
    return json({ error: 'Kontrolli salvestamine ebaõnnestus. Uuenda andmeid ja proovi uuesti.' }, 500)
  }
})
