import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { processStoreSettlement } from '../_shared/order-settlement.ts'
import { assertStripeMode } from '../_shared/stripe-mode.ts'
import { captureEdgeError } from '../_shared/security.ts'

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (request.headers.get('Authorization') !== `Bearer ${requiredEnv('ONBOARDING_CRON_SECRET')}`) {
    return json({ error: 'Unauthorized' }, 401)
  }
  // A deploy can stage the schema/functions before enabling any money movement.
  if (Deno.env.get('STRIPE_SETTLEMENT_WORKER_ENABLED') === 'false') return json({ enabled: false })
  const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const key = requiredEnv('STRIPE_SECRET_KEY')
  const mode = assertStripeMode(key)
  const stripe = new Stripe(key, { timeout: 10_000, maxNetworkRetries: 1 })
  const outcomes: Record<string, number> = {}
  const startedAt = Date.now()
  try {
    for (let index = 0; index < 10 && Date.now() - startedAt < 40_000; index += 1) {
      const result = await processStoreSettlement({
        admin, stripe,
        onError: (error, orderId, status) => captureEdgeError('stripe-order-settlements', error, { order_id: orderId, settlement_status: status }, 'critical'),
      }, mode)
      if (!result) break
      outcomes[result.status] = (outcomes[result.status] ?? 0) + 1
    }
    return json({ outcomes })
  } catch (error) {
    await captureEdgeError('stripe-order-settlements', error, {}, 'critical')
    return json({ error: 'Maksearvestuse taustatöö ebaõnnestus.', outcomes }, 500)
  }
})
