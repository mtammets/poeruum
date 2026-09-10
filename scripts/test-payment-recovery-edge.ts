// Actual signed webhook + recovery handlers and SDKs, with all HTTP mocked.
import Stripe from 'npm:stripe@^22'
type Handler = (request: Request) => Response | Promise<Response>
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }

Deno.test('a signed event survives a local crash, resumes via cron and deduplicates redelivery', async () => {
  const originalServe = Deno.serve, originalFetch = globalThis.fetch, originalError = console.error
  const values = { SUPABASE_URL: 'https://recovery.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'test-only',
    STRIPE_SECRET_KEY: 'sk_test_local', STRIPE_WEBHOOK_SECRET: 'whsec_local_test', STRIPE_MODE: 'test',
    ONBOARDING_CRON_SECRET: 'cron-local-test', PAYMENT_RECOVERY_WORKER_ENABLED: 'true',
    STRIPE_SETTLEMENT_WORKER_ENABLED: 'false', ORDER_EMAIL_WORKER_ENABLED: 'false' }
  const previous = new Map(Object.keys(values).map((key) => [key, Deno.env.get(key)]))
  const order = { id: '79000000-0000-4000-8000-000000000003', store_id: '79000000-0000-4000-8000-000000000002',
    total: 27.32, payment_status: 'pending', stripe_mode: 'test', stripe_checkout_session_id: 'cs_test_recovery',
    stripe_payment_intent_id: null as string | null, created_at: new Date().toISOString() }
  const pi = { id: 'pi_recovery', status: 'succeeded', livemode: false, amount: 2732, amount_received: 2732, currency: 'eur',
    metadata: { order_id: order.id, store_id: order.store_id },
    latest_charge: { id: 'ch_recovery', status: 'succeeded', paid: true, captured: true, refunded: false, amount_refunded: 0 } }
  const session = { id: order.stripe_checkout_session_id, mode: 'payment', status: 'complete', payment_status: 'paid', livemode: false,
    amount_total: 2732, currency: 'eur', client_reference_id: order.store_id, metadata: pi.metadata, payment_intent: pi }
  // Its old failure is deliberately contradicted by the current paid session.
  const event = { id: 'evt_recovery', object: 'event', type: 'checkout.session.async_payment_failed', livemode: false,
    created: Math.floor(Date.now()/1000), data: { object: { ...session, payment_status: 'unpaid' } } }
  let handler: Handler | undefined, saved: Record<string, any> | null = null
  let failCommit = true, confirmations = 0, invalidNetwork = false
  try {
    for (const [key,value] of Object.entries(values)) Deno.env.set(key,value)
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    console.error = () => {}
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const method = init?.method || (input instanceof Request ? input.method : 'GET')
      const body = JSON.parse(String(init?.body || '{}'))
      if (url.origin === 'https://api.stripe.com' && method === 'GET') {
        if (url.pathname === `/v1/checkout/sessions/${session.id}`) return Response.json(session)
        if (url.pathname === `/v1/payment_intents/${pi.id}`) return Response.json(pi)
      }
      if (url.origin === values.SUPABASE_URL) {
        if (url.pathname.endsWith('/orders') && method === 'GET') return Response.json({ ...order })
        if (url.pathname.endsWith('/rpc/record_application_error')) return Response.json(null)
        if (url.pathname.endsWith('/rpc/claim_stripe_webhook')) {
          if (saved?.processed_at) return Response.json({ state: 'processed' })
          if (saved?.lease_token) return Response.json({ state: 'busy' })
          saved = { event_id: body.event_id_value, event_type: body.event_type_value, payload: body.payload_value,
            connected_account_id: null, lease_token: 'lease-webhook', processed_at: null }
          return Response.json({ state: 'claimed', token: saved.lease_token })
        }
        if (url.pathname.endsWith('/rpc/finish_stripe_webhook')) {
          assert(saved && saved.lease_token === body.token_value, 'Stale event worker saved')
          saved!.lease_token = null
          saved!.recovery_status = body.outcome_value
          if (body.outcome_value === 'completed') saved!.processed_at = new Date().toISOString()
          return Response.json(null)
        }
        if (url.pathname.endsWith('/rpc/claim_order_payment_recovery')) return Response.json([])
        if (url.pathname.endsWith('/rpc/claim_stored_stripe_webhook')) {
          if (!saved || saved.processed_at || saved.lease_token) return Response.json([])
          saved.lease_token = 'lease-cron'; return Response.json([{ ...saved }])
        }
        if (url.pathname.endsWith('/rpc/bind_stripe_checkout') || url.pathname.endsWith('/rpc/repair_paid_order_jobs')) return Response.json(null)
        if (url.pathname.endsWith('/rpc/complete_stripe_order')) {
          if (failCommit) return Response.json({ message: 'Simulated database crash' }, { status: 500 })
          if (order.payment_status !== 'paid') confirmations++
          order.payment_status = 'paid'; order.stripe_payment_intent_id = pi.id
          return Response.json(null)
        }
      }
      invalidNetwork = true
      throw new Error(`Unexpected network call: ${method} ${url.pathname}`)
    }
    await import('../supabase/functions/stripe-webhook/index.ts')
    const webhook = handler!
    const payload = JSON.stringify(event)
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: values.STRIPE_WEBHOOK_SECRET,
      cryptoProvider: Stripe.createSubtleCryptoProvider() })
    const request = (sig = signature) => new Request(values.SUPABASE_URL, { method: 'POST', headers: { 'stripe-signature': sig }, body: payload })
    assert((await webhook(request('invalid'))).status === 400 && saved === null, 'Invalid signature reached queue')
    assert((await webhook(request())).status === 500, 'DB failure acknowledged as success')
    const stored = saved as Record<string, any> | null
    assert(stored?.payload && !stored.processed_at && stored.recovery_status === 'retry', 'Signed event lost after failure')
    stored!.lease_token = 'active-worker'
    assert((await webhook(request())).status === 503, 'Active worker treated as completed duplicate')
    stored!.lease_token = null
    failCommit = false
    await import('../supabase/functions/stripe-reservation-reaper/index.ts')
    const worker = handler!
    const cron = () => new Request(values.SUPABASE_URL, { method: 'POST', headers: { Authorization: `Bearer ${values.ONBOARDING_CRON_SECRET}` } })
    assert((await worker(new Request(values.SUPABASE_URL, { method: 'POST' }))).status === 401, 'Recovery auth bypassed')
    Deno.env.set('PAYMENT_RECOVERY_WORKER_ENABLED', 'false')
    assert((await (await worker(cron())).json()).skipped, 'Disabled recovery ran')
    Deno.env.set('PAYMENT_RECOVERY_WORKER_ENABLED', 'true')
    const response = await worker(cron())
    assert(response.status === 200 && (await response.json()).outcomes.event_completed === 1, 'Cron failed to resume signed event')
    assert(order.payment_status === 'paid' && confirmations === 1 && stored?.processed_at, 'Recovery did not confirm payment once')
    assert((await (await webhook(request())).json()).duplicate === true && confirmations === 1, 'Completed redelivery repeated work')
    assert(!invalidNetwork, 'Unexpected money, mail or external request')
  } finally {
    Deno.serve = originalServe; globalThis.fetch = originalFetch; console.error = originalError
    for (const [key,value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key,value) }
  }
})
