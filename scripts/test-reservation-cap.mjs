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
const email = `reservation-cap-${suffix}@example.com`
const password = `Reservation-${crypto.randomUUID()}!Aa1`
const capProductId = `cap-product-${suffix}`
const stockProductId = `stock-product-${suffix}`
let userId
let storeId

const createOrder = async ({ requestId, productId, subtotal, expiresAt }) => {
  const { data, error } = await admin.rpc('create_stripe_order_with_reservation', {
    target_store_id: storeId,
    request_id: requestId,
    order_number_value: `TEST-${crypto.randomUUID()}`,
    order_items: [{
      id: productId,
      name: 'Atomaarse arvestuse testtoode',
      quantity: 1,
      selectedOptions: {},
    }],
    customer_name_value: 'Reserveeringu test',
    customer_email_value: email,
    delivery_value: 'Järeletulemine',
    product_subtotal_value: subtotal,
    total_value: subtotal,
    stripe_mode_value: stripeMode,
    reservation_expires_at_value: expiresAt,
  })
  if (error) throw error
  return data
}

try {
  const { data: userResult, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (userError) throw userError
  userId = userResult.user.id

  const { data: store, error: storeError } = await admin.from('stores').insert({
    owner_id: userId,
    name: 'Reserveeringu ja limiidi E2E',
    slug: `reservation-cap-${suffix}`.toLowerCase(),
    pricing_plan: 'flexible',
  }).select('id').single()
  if (storeError) throw storeError
  storeId = store.id

  const { error: productError } = await admin.from('products').insert([
    {
      id: capProductId,
      store_id: storeId,
      name: 'Kuutasu limiidi testtoode',
      image_url: 'https://placehold.co/800x1000/png',
      price: 500,
      stock: null,
    },
    {
      id: stockProductId,
      store_id: storeId,
      name: 'Reserveeringu testtoode',
      image_url: 'https://placehold.co/800x1000/png',
      price: 10,
      stock: 1,
    },
  ])
  if (productError) throw productError

  const capExpiry = new Date(Date.now() + 35 * 60 * 1000).toISOString()
  const firstRequestId = crypto.randomUUID()
  const [firstCapOrder, secondCapOrder] = await Promise.all([
    createOrder({ requestId: firstRequestId, productId: capProductId, subtotal: 500, expiresAt: capExpiry }),
    createOrder({ requestId: crypto.randomUUID(), productId: capProductId, subtotal: 500, expiresAt: capExpiry }),
  ])
  const reservedFees = [
    Number(firstCapOrder.stripe_platform_fee_net_cents),
    Number(secondCapOrder.stripe_platform_fee_net_cents),
  ].sort((left, right) => left - right)
  if (reservedFees[0] !== 1900 || reservedFees[1] !== 2000) {
    throw new Error(`Paralleelsete checkout’ide limiit on vale: ${JSON.stringify(reservedFees)}.`)
  }

  const repeatedOrder = await createOrder({
    requestId: firstRequestId,
    productId: capProductId,
    subtotal: 500,
    expiresAt: capExpiry,
  })
  if (repeatedOrder.id !== firstCapOrder.id
    || Number(repeatedOrder.stripe_platform_fee_net_cents) !== Number(firstCapOrder.stripe_platform_fee_net_cents)) {
    throw new Error('Idempotentne korduspäring muutis kuutasu reserveeringut.')
  }

  const protectedStripeOrder = await createOrder({
    requestId: crypto.randomUUID(),
    productId: stockProductId,
    subtotal: 10,
    expiresAt: new Date(Date.now() + 1200).toISOString(),
  })
  const { error: sessionIdError } = await admin.from('orders').update({
    stripe_checkout_session_id: `cs_${stripeMode}_${crypto.randomUUID()}`,
  }).eq('id', protectedStripeOrder.id)
  if (sessionIdError) throw sessionIdError
  const expiringUnstartedOrder = await createOrder({
    requestId: crypto.randomUUID(),
    productId: capProductId,
    subtotal: 10,
    expiresAt: new Date(Date.now() + 1200).toISOString(),
  })
  await new Promise((resolve) => setTimeout(resolve, 1600))

  let protectedReservationBlocked = false
  try {
    await createOrder({
      requestId: crypto.randomUUID(),
      productId: stockProductId,
      subtotal: 10,
      expiresAt: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
    })
  } catch (reservationError) {
    protectedReservationBlocked = String(reservationError?.message).includes('INSUFFICIENT_STOCK:')
  }
  if (!protectedReservationBlocked) {
    throw new Error('Stripe’i sessiooniga reserveering vabastati enne sessiooni oleku kinnitamist.')
  }

  const { error: verifiedReleaseError } = await admin.rpc('release_stripe_order', {
    target_order_id: protectedStripeOrder.id,
  })
  if (verifiedReleaseError) throw verifiedReleaseError
  const replacementOrder = await createOrder({
    requestId: crypto.randomUUID(),
    productId: stockProductId,
    subtotal: 10,
    expiresAt: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
  })
  if (!replacementOrder?.id) throw new Error('Aegunud reserveering ei vabastanud laoseisu.')

  const { data: releasedCount, error: releaseError } = await admin.rpc(
    'release_expired_unstarted_stripe_orders',
    { batch_size_value: 100 },
  )
  if (releaseError) throw releaseError
  if (Number(releasedCount) < 1) throw new Error('Aegunud alustamata reserveeringut ei koristatud.')

  const { data: expiredState, error: expiredStateError } = await admin.from('orders')
    .select('payment_status,reservation_expires_at')
    .eq('id', expiringUnstartedOrder.id)
    .single()
  if (expiredStateError) throw expiredStateError
  if (expiredState.payment_status !== 'failed' || expiredState.reservation_expires_at !== null) {
    throw new Error(`Aegunud reserveeringu lõppolek on vale: ${JSON.stringify(expiredState)}.`)
  }

  const { error: publicRpcError } = await publicClient.rpc('release_expired_unstarted_stripe_orders', {
    batch_size_value: 100,
  })
  if (!publicRpcError) throw new Error('Avalik klient sai reserveeringute koristaja käivitada.')

  console.log(JSON.stringify({
    result: 'ok',
    concurrentFeeReservations: reservedFees,
    monthlyNetCapCents: reservedFees.reduce((sum, value) => sum + value, 0),
    expiredReservationReleased: true,
    stripeBackedReservationHeldUntilVerified: true,
    publicCleanupDenied: true,
  }, null, 2))
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => null)
}
