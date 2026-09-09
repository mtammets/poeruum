// Real Edge handlers and Resend signature verification, with all HTTP calls
// intercepted. This test requires no live credentials and sends no mail.
type Handler = (request: Request) => Response | Promise<Response>
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }

Deno.test('order delivery webhook verifies signatures and retries failed atomic writes; worker requires its secret', async () => {
  const originalServe = Deno.serve
  const originalFetch = globalThis.fetch
  const originalError = console.error
  const values: Record<string, string> = {
    SUPABASE_URL: 'https://edge-test.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'local-test-key',
    RESEND_API_KEY: 're_local_test', RESEND_WEBHOOK_SECRET: 'whsec_' + btoa('local-webhook-signing-key'),
    ONBOARDING_CRON_SECRET: 'local-worker-secret', STRIPE_SECRET_KEY: 'sk_test_local', STRIPE_MODE: 'test',
    ORDER_EMAIL_WORKER_ENABLED: 'true',
  }
  const previous = new Map(Object.keys(values).map((name) => [name, Deno.env.get(name)]))
  let handler: Handler | undefined
  let failDelivery = false
  const calls: { path: string; body: Record<string, unknown> }[] = []
  try {
    Object.entries(values).forEach(([name,value]) => Deno.env.set(name,value))
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    console.error = () => {} // Expected signature and simulated DB failures.
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      assert(url.origin === values.SUPABASE_URL, 'Unexpected external network call')
      const body = JSON.parse(String(init?.body || '{}'))
      calls.push({ path: url.pathname, body })
      if (url.pathname.endsWith('/rpc/record_order_email_delivery')) {
        return failDelivery ? Response.json({ message: 'Simulated DB failure' }, { status: 500 }) : Response.json(true)
      }
      if (url.pathname.endsWith('/rpc/record_application_error')) return Response.json(null)
      if (url.pathname.endsWith('/rpc/claim_order_email_job')) return Response.json([])
      throw new Error(`Unexpected DB call: ${url.pathname}`)
    }
    await import('../supabase/functions/resend-webhook/index.ts')
    assert(handler, 'Webhook handler was not registered')
    const webhook = handler!
    const eventId = 'msg_local_order_email'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: {
      email_id: 'local-resend-id', to: ['customer@example.invalid'], tags: {
        email_type: 'order_customer_confirmation', order_id: '77000000-0000-4000-8000-000000000003',
        order_email_job_id: '77000000-0000-4000-8000-000000000004',
      },
    } })
    const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode('local-webhook-signing-key'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',hmacKey,
      new TextEncoder().encode(`${eventId}.${timestamp}.${body}`)))))
    const request = (valid = true) => new Request('https://edge-test.example.invalid/functions/v1/resend-webhook', {
      method: 'POST', headers: { 'svix-id': eventId, 'svix-timestamp': timestamp,
        'svix-signature': `v1,${valid ? signature : btoa('invalid-signature')}`, 'Content-Type': 'application/json' }, body,
    })
    assert((await webhook(request(false))).status === 400, 'Invalid signature was accepted')
    assert(calls.length === 0, 'Invalid signature touched the database')
    failDelivery = true
    assert((await webhook(request())).status === 500, 'Failed delivery write did not ask Resend to retry')
    failDelivery = false
    assert((await webhook(request())).status === 200, 'Retried delivery did not succeed')
    assert((await webhook(request())).status === 200, 'Duplicate delivery was not accepted')
    assert(calls.filter((call) => call.path.endsWith('/rpc/record_order_email_delivery')).length === 3, 'Order callback bypassed the atomic RPC')
    assert(!calls.some((call) => call.path.endsWith('/resend_webhook_events')), 'Order receipt was inserted separately from delivery')

    await import('../supabase/functions/order-emails/index.ts')
    const worker = handler!
    calls.length = 0
    assert((await worker(new Request('https://edge-test.example.invalid', { method: 'POST' }))).status === 401, 'Unauthenticated worker request was accepted')
    assert((await worker(new Request('https://edge-test.example.invalid'))).status === 405, 'Worker accepted GET')
    assert(calls.length === 0, 'Unauthorized worker touched jobs')
    const authorized = () => new Request('https://edge-test.example.invalid', { method: 'POST', headers: { Authorization: 'Bearer local-worker-secret' } })
    Deno.env.set('ORDER_EMAIL_WORKER_ENABLED', 'false')
    assert((await worker(authorized())).status === 200 && calls.length === 0, 'Disabled worker touched jobs')
    Deno.env.set('ORDER_EMAIL_WORKER_ENABLED', 'true')
    assert((await worker(authorized())).status === 200, 'Authorized worker did not run')
    assert(calls.length === 1 && calls[0].body.mode_value === 'test', 'Worker did not use the configured Stripe mode')
  } finally {
    Deno.serve = originalServe
    globalThis.fetch = originalFetch
    console.error = originalError
    for (const [name,value] of previous) { if (value === undefined) Deno.env.delete(name); else Deno.env.set(name,value) }
  }
})
