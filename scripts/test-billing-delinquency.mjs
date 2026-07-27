import crypto from 'node:crypto'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

config({ path: '.env', quiet: true })

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const supabaseUrl = required('VITE_SUPABASE_URL')
const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() || required('SUPABASE_SERVICE_ROLE_KEY')
const publishableKey = required('VITE_SUPABASE_PUBLISHABLE_KEY')
const stripeMode = required('STRIPE_SECRET_KEY').startsWith('sk_live_') ? 'live' : 'test'
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
}
const admin = createClient(supabaseUrl, serviceKey, options)
const publicClient = createClient(supabaseUrl, publishableKey, options)
const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
const email = `billing-delinquency-${suffix}@example.com`
const productId = `billing-product-${suffix}`
let userId
let storeId

const createOrder = async (label) => {
  const { data, error } = await admin.rpc('create_stripe_order_with_reservation', {
    target_store_id: storeId,
    request_id: crypto.randomUUID(),
    order_number_value: `BILLING-${label}-${crypto.randomUUID()}`,
    order_items: [{ id: productId, name: 'Arvelduse testtoode', quantity: 1, selectedOptions: {} }],
    customer_name_value: 'Arvelduse test',
    customer_email_value: email,
    delivery_value: 'Järeletulemine',
    product_subtotal_value: 100,
    total_value: 100,
    stripe_mode_value: stripeMode,
    reservation_expires_at_value: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
  })
  if (error) throw error
  return data
}

const assertFee = (order, expectedNet, expectedVat, label) => {
  const actual = {
    net: Number(order.stripe_platform_fee_net_cents),
    vat: Number(order.stripe_platform_fee_vat_cents),
  }
  if (actual.net !== expectedNet || actual.vat !== expectedVat) {
    throw new Error(`${label}: oodatud tasu ${expectedNet}+${expectedVat}, saadi ${actual.net}+${actual.vat}.`)
  }
}

try {
  const { data: userResult, error: userError } = await admin.auth.admin.createUser({
    email,
    password: `Billing-${crypto.randomUUID()}!Aa1`,
    email_confirm: true,
  })
  if (userError) throw userError
  userId = userResult.user.id

  const { data: store, error: storeError } = await admin.from('stores').insert({
    owner_id: userId,
    name: 'Arvelduse armuaja E2E',
    slug: `billing-delinquency-${suffix}`.toLowerCase(),
    pricing_plan: 'fixed',
    stripe_subscription_status: 'active',
  }).select('id').single()
  if (storeError) throw storeError
  storeId = store.id

  const { error: productError } = await admin.from('products').insert({
    id: productId,
    store_id: storeId,
    name: 'Arvelduse testtoode',
    image_url: 'https://placehold.co/800x1000/png',
    price: 100,
  })
  if (productError) throw productError

  assertFee(await createOrder('active'), 0, 0, 'Aktiivne Kindel pakett')

  const delinquentAt = new Date().toISOString()
  const { error: graceError } = await admin.from('stores').update({
    stripe_subscription_status: 'past_due',
    billing_delinquent_at: delinquentAt,
    billing_grace_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }).eq('id', storeId)
  if (graceError) throw graceError
  assertFee(await createOrder('grace'), 0, 0, 'Kindla paketi armuaeg')

  const { error: expiredError } = await admin.from('stores').update({
    stripe_subscription_status: 'unpaid',
    billing_delinquent_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    billing_grace_ends_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  }).eq('id', storeId)
  if (expiredError) throw expiredError
  assertFee(await createOrder('expired'), 400, 96, 'Lõppenud armuaeg')

  const { error: publicError } = await publicClient.rpc('effective_store_pricing_plan', {
    target_store_id: storeId,
  })
  if (!publicError) throw new Error('Avalik klient sai lugeda poe serveripoolset arveldusõigust.')

  console.log(JSON.stringify({
    result: 'ok',
    activeFixedFeeCents: 0,
    graceFixedFeeCents: 0,
    expiredFlexibleFeeNetCents: 400,
    expiredFlexibleFeeVatCents: 96,
    publicEntitlementDenied: true,
  }, null, 2))
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => null)
}
