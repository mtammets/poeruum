import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { loadOrderReceipt, parseReceiptAccess } from '../_shared/order-receipt.ts'
import { assertStripeMode } from '../_shared/stripe-mode.ts'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })
const env = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const access = parseReceiptAccess(await request.json().catch(() => null))
    if (!access) return json({ error: 'Tellimuse kinnituslink on puudulik või vigane.' }, 400)
    const rate = await checkRateLimit(request, 'order-receipt', 60, 60)
    if (!rate.allowed) return rateLimitResponse(rate.retry_after_seconds, headers)
    const admin = createClient(env('SUPABASE_URL'), env('POERUUM_SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
    const key = env('STRIPE_SECRET_KEY')
    const mode = assertStripeMode(key)
    const receipt = await loadOrderReceipt({ admin, stripe: new Stripe(key, { httpClient: Stripe.createFetchHttpClient(), timeout: 10000, maxNetworkRetries: 1 }), mode }, access)
    return receipt ? json({ receipt }) : json({ error: 'Selle lingiga tellimust ei leitud.' }, 404)
  } catch (error) {
    // Do not include bearer credentials or the request body in logs.
    await captureEdgeError('order-receipt', error)
    return json({ error: 'Tellimuse olekut ei õnnestunud praegu kontrollida. Proovi uuesti.' }, 503)
  }
})
