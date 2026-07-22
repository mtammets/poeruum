import crypto from 'node:crypto'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

config({ path: '.env', quiet: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const stripeKey = process.env.STRIPE_SECRET_KEY
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
if (!supabaseUrl || !anonKey || !serviceKey || !stripeKey?.startsWith('sk_test_') || !webhookSecret) {
  throw new Error('Test nõuab Supabase’i võtmeid, Stripe’i testvõtit ja webhooki saladust.')
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
})
const stripeRequest = async (path, options = {}) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${stripeKey}`, ...options.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error?.message || `Stripe vastas ${response.status}.`)
  return body
}
const stripePost = (path, values, idempotencyKey) => {
  const body = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => body.set(key, String(value)))
  return stripeRequest(path, { method: 'POST', body, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} })
}
const waitFor = async (check, label, attempts = 60) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`${label} ei jõudnud oodatud olekusse.`)
}

const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`
const productId = `stripe-settlement-test-${suffix}`
const checkoutRequestId = crypto.randomUUID()
let store
let originalStore
let order
let checkoutSessionId
let testEventId
let testPaymentIntentId

try {
  const { data: connectedStore, error: storeError } = await admin.from('stores')
    .select('*')
    .eq('payment_provider', 'stripe')
    .eq('payment_status', 'connected')
    .eq('stripe_account_mode', 'test')
    .not('stripe_account_id', 'is', null)
    .limit(1)
    .maybeSingle()
  if (storeError) throw storeError
  if (!connectedStore) throw new Error('Ühendatud Stripe’i testpoodi ei leitud.')
  store = connectedStore
  originalStore = { is_published: store.is_published, settings: store.settings }

  const testSettings = {
    ...(store.settings ?? {}),
    customerConfirmations: false,
    sellerNotifications: false,
    deliverySettings: { ...((store.settings ?? {}).deliverySettings ?? {}), pickupEnabled: true },
  }
  const { error: prepareStoreError } = await admin.from('stores').update({ is_published: true, settings: testSettings }).eq('id', store.id)
  if (prepareStoreError) throw prepareStoreError
  const { error: productError } = await admin.from('products').insert({
    id: productId,
    store_id: store.id,
    name: 'Stripe’i arvelduse testtoode',
    description: 'Ajutine automaattesti toode',
    image_url: 'https://placehold.co/800x1000/png',
    alt: 'Stripe’i testtoode',
    price: 10,
    stock: 2,
    slug: productId,
  })
  if (productError) throw productError

  const response = await fetch(`${supabaseUrl}/functions/v1/stripe-store-checkout`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      storeId: store.id,
      checkoutRequestId,
      returnUrl: `https://${store.slug}.poeruum.ee`,
      items: [{ id: productId, quantity: 1, selectedOptions: {} }],
      customer: { name: 'Stripe Settlement Test', email: 'stripe-settlement-test@example.com', phone: '+37255555555' },
      delivery: { type: 'pickup', label: 'Testi järeletulemine' },
    }),
  })
  const checkout = await response.json().catch(() => ({}))
  if (!response.ok || !checkout.url) throw new Error(checkout.error || `Checkout vastas ${response.status}.`)

  checkoutSessionId = new URL(checkout.url).pathname.split('/').filter(Boolean).at(-1)?.split('#')[0]
  if (!checkoutSessionId) throw new Error('Checkout Session ID puudub.')
  order = await waitFor(async () => {
    const { data, error } = await admin.from('orders').select('*').eq('checkout_request_id', checkoutRequestId).maybeSingle()
    if (error) throw error
    return data
  }, 'Checkouti tellimus')

  const paymentIntent = await stripePost('payment_intents', {
    amount: Math.round(Number(order.total) * 100),
    currency: 'eur',
    payment_method: 'pm_card_visa',
    'automatic_payment_methods[enabled]': true,
    'automatic_payment_methods[allow_redirects]': 'never',
    confirm: true,
    on_behalf_of: store.stripe_account_id,
    transfer_group: `order_${order.id}`,
    'metadata[store_id]': store.id,
    'metadata[order_id]': order.id,
    'metadata[order_number]': order.order_number,
    'metadata[stripe_mode]': 'test',
    'metadata[platform_fee_cents]': 40,
    'metadata[seller_account_id]': store.stripe_account_id,
  }, `settlement-test-payment-${checkoutRequestId}`)
  testPaymentIntentId = paymentIntent.id
  if (paymentIntent.status !== 'succeeded') throw new Error(`Testmakse olek on ${paymentIntent.status}.`)

  testEventId = `evt_settlement_${suffix.replaceAll('-', '')}`
  const event = {
    id: testEventId,
    object: 'event',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: null,
    data: { object: {
      id: checkoutSessionId,
      object: 'checkout.session',
      mode: 'payment',
      payment_status: 'paid',
      payment_intent: paymentIntent.id,
      client_reference_id: store.id,
      metadata: { store_id: store.id, order_id: order.id, order_number: order.order_number },
    } },
  }
  const payload = JSON.stringify(event)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = crypto.createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex')
  const webhookResponse = await fetch(`${supabaseUrl}/functions/v1/stripe-webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
    body: payload,
  })
  const webhookResult = await webhookResponse.json().catch(() => ({}))
  if (!webhookResponse.ok) throw new Error(`Webhook vastas ${webhookResponse.status}: ${webhookResult.detail ?? webhookResult.error ?? 'tundmatu viga'}`)

  order = await waitFor(async () => {
    const { data, error } = await admin.from('orders').select('*').eq('checkout_request_id', checkoutRequestId).maybeSingle()
    if (error) throw error
    return data?.payment_status === 'paid' && data.stripe_transfer_id ? data : null
  }, 'Tasutud tellimus ja müüja ülekanne')

  const transfer = await stripeRequest(`transfers/${order.stripe_transfer_id}`)
  const expectedNet = Math.round(Number(order.total) * 100)
    - Number(order.stripe_processing_fee_cents)
    - Number(order.stripe_platform_fee_cents)
  if (Number(order.stripe_processing_fee_cents) <= 0) throw new Error('Stripe’i tegelikku maksetasu ei salvestatud.')
  if (Number(order.stripe_platform_fee_cents) !== 40) throw new Error(`Poeruumi 4% tasu on vale: ${order.stripe_platform_fee_cents}.`)
  if (Number(order.stripe_seller_net_cents) !== expectedNet) throw new Error('Müüja netosumma ei vasta tasude jaotusele.')
  if (Number(transfer.amount) !== expectedNet || transfer.destination !== store.stripe_account_id) throw new Error('Stripe’i ülekanne ei vasta salvestatud netosummale.')

  console.log(JSON.stringify({
    result: 'ok',
    orderTotalCents: Math.round(Number(order.total) * 100),
    stripeProcessingFeeCents: order.stripe_processing_fee_cents,
    poeruumFeeCents: order.stripe_platform_fee_cents,
    sellerNetCents: order.stripe_seller_net_cents,
    transferId: order.stripe_transfer_id,
  }, null, 2))
} finally {
  if (order?.id) {
    const { data: latestOrder } = await admin.from('orders').select('*').eq('id', order.id).maybeSingle()
    if (latestOrder) order = latestOrder
  }
  const paymentIntentId = order?.stripe_payment_intent_id ?? testPaymentIntentId
  if (paymentIntentId) {
    await stripePost('refunds', { payment_intent: paymentIntentId }, `settlement-test-refund-${order?.id ?? checkoutRequestId}`).catch(() => null)
  }
  if (order?.stripe_transfer_id) {
    const transfer = await stripeRequest(`transfers/${order.stripe_transfer_id}`).catch(() => null)
    if (transfer && !transfer.reversed) {
      await stripePost(`transfers/${order.stripe_transfer_id}/reversals`, {}, `settlement-test-reversal-${order.id}`).catch(() => null)
    }
    await admin.from('revenue_events').delete().eq('provider_object_id', order.stripe_transfer_id)
  }
  if (order?.id) await admin.from('orders').delete().eq('id', order.id)
  if (testEventId) await admin.from('stripe_webhook_events').delete().eq('event_id', testEventId)
  if (checkoutSessionId) await stripePost(`checkout/sessions/${checkoutSessionId}/expire`, {}, `settlement-test-expire-${checkoutRequestId}`).catch(() => null)
  await admin.from('products').delete().eq('id', productId)
  if (store && originalStore) {
    await admin.from('stores').update(originalStore).eq('id', store.id)
  }
}
