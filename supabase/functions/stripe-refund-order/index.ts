import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { assertStoredStripeMode, assertStripeMode } from '../_shared/stripe-mode.ts'

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
    const stripe = new Stripe(stripeSecretKey)
    const usesSeparateTransfer = typeof order.stripe_transfer_id === 'string' && order.stripe_transfer_id.length > 0
    const refund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_intent_id,
      ...(!usesSeparateTransfer ? { reverse_transfer: true, refund_application_fee: true } : {}),
      metadata: { store_id: store.id, order_id: order.id, order_number: order.order_number },
    }, { idempotencyKey: `poeruum-order-refund-${order.id}` })
    if (!['succeeded', 'pending'].includes(refund.status ?? '')) throw new Error('Stripe ei kinnitanud tagastust.')
    if (usesSeparateTransfer) {
      const transfer = await stripe.transfers.retrieve(order.stripe_transfer_id)
      if (!transfer.reversed) {
        await stripe.transfers.createReversal(order.stripe_transfer_id, {}, {
          idempotencyKey: `poeruum-order-transfer-reversal-${order.id}`,
        })
      }
    }
    const { error: updateError } = await admin.from('orders').update({ status: 'refunded', payment_status: 'refunded' }).eq('id', order.id)
    if (updateError) throw updateError
    const platformFeeCents = Math.max(0, Number(order.stripe_platform_fee_cents ?? 0))
    const platformFeeNetCents = Math.max(0, Number(order.stripe_platform_fee_net_cents ?? platformFeeCents))
    const platformFeeVatCents = Math.max(0, Number(order.stripe_platform_fee_vat_cents ?? 0))
    if (usesSeparateTransfer && platformFeeCents > 0) {
      const { error: revenueError } = await admin.from('revenue_events').upsert({
        provider: 'stripe',
        provider_event_id: refund.id,
        provider_object_id: refund.id,
        store_id: store.id,
        kind: 'transaction_fee_refund',
        amount_cents: -platformFeeNetCents,
        currency: refund.currency.toLowerCase(),
        description: 'Tagastatud müügitasu ja käibemaks',
        occurred_at: new Date(refund.created * 1000).toISOString(),
        metadata: {
          refund_id: refund.id,
          transfer_id: order.stripe_transfer_id,
          net_amount_cents: -platformFeeNetCents,
          vat_amount_cents: -platformFeeVatCents,
          gross_amount_cents: -platformFeeCents,
          vat_rate: 24,
        },
      }, { onConflict: 'provider,provider_event_id', ignoreDuplicates: true })
      if (revenueError) throw revenueError
    }
    return json({ refunded: true, status: refund.status })
  } catch (error) {
    console.error('Stripe’i tagastus ebaõnnestus.', error)
    return json({ error: error instanceof Error ? error.message : 'Tagastus ebaõnnestus.' }, 500)
  }
})
