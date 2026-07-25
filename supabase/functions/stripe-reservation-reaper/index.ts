import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { assertStoredStripeMode, assertStripeMode } from '../_shared/stripe-mode.ts'

type PendingOrder = {
  id: string
  stripe_checkout_session_id: string | null
  stripe_mode: 'test' | 'live' | null
}

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (request.headers.get('Authorization') !== `Bearer ${requiredEnv('ONBOARDING_CRON_SECRET')}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const stripeSecretKey = requiredEnv('STRIPE_SECRET_KEY')
  const stripeMode = assertStripeMode(stripeSecretKey)
  const stripe = new Stripe(stripeSecretKey)
  let released = 0
  let retained = 0
  let failed = 0

  const { data: unstartedCount, error: unstartedError } = await admin.rpc(
    'release_expired_unstarted_stripe_orders',
    { batch_size_value: 100 },
  )
  if (unstartedError) return json({ error: 'Unstarted reservation cleanup failed' }, 500)
  released += Number(unstartedCount ?? 0)

  const { data, error } = await admin.from('orders')
    .select('id,stripe_checkout_session_id,stripe_mode')
    .eq('payment_status', 'pending')
    .lte('reservation_expires_at', new Date().toISOString())
    .not('stripe_checkout_session_id', 'is', null)
    .order('reservation_expires_at')
    .limit(100)
  if (error) return json({ error: 'Reservation query failed' }, 500)

  for (const order of (data ?? []) as PendingOrder[]) {
    try {
      assertStoredStripeMode(order.stripe_mode, stripeMode, 'Tellimuse reserveering')
      let session = await stripe.checkout.sessions.retrieve(String(order.stripe_checkout_session_id))
      if (session.status === 'open' && session.expires_at <= Math.floor(Date.now() / 1000)) {
        session = await stripe.checkout.sessions.expire(session.id)
      }

      if (session.status === 'expired') {
        const { error: releaseError } = await admin.rpc('release_stripe_order', { target_order_id: order.id })
        if (releaseError) throw releaseError
        released += 1
      } else if (session.status === 'complete' && session.payment_status === 'unpaid') {
        // Asynchronous bank methods can finish after Checkout itself closes.
        const asyncExpiry = new Date((session.created + 31 * 24 * 60 * 60) * 1000).toISOString()
        const { error: extendError } = await admin.from('orders')
          .update({ reservation_expires_at: asyncExpiry })
          .eq('id', order.id)
          .eq('payment_status', 'pending')
        if (extendError) throw extendError
        retained += 1
      } else {
        // A completed paid session must be settled by the signed webhook. Stripe
        // retries failed webhooks, so never free its stock from this fallback job.
        retained += 1
      }
    } catch (cleanupError) {
      failed += 1
      console.error(`Reserveeringu ${order.id} kontroll ebaõnnestus.`, cleanupError)
    }
  }

  return json({ released, retained, failed })
})
