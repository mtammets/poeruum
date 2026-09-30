// Exercise real handlers with all networking intercepted; no Stripe accounts
// or emails are created. Policy failure must precede every Stripe write.
type Handler = (request: Request) => Response | Promise<Response>
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message) }

Deno.test('merchant email policy protects Connect sessions and Billing, and fails closed', async () => {
  const originalServe = Deno.serve
  const originalFetch = globalThis.fetch
  const originalError = console.error
  const env = {
    SUPABASE_URL: 'https://policy-test.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'test-secret',
    POERUUM_SUPABASE_PUBLISHABLE_KEY: 'test-public', STRIPE_SECRET_KEY: 'sk_test_policy',
    STRIPE_MODE: 'test', RATE_LIMIT_SALT: 'test-salt', APP_URL: 'https://poeruum.ee',
  }
  const previous = new Map(Object.keys(env).map((key) => [key, Deno.env.get(key)]))
  let handler: Handler | undefined
  let policy: 'blocked' | 'allowed' | 'unavailable' = 'blocked'
  let hasStore = true
  let stripeCalls = 0
  let policyCalls = 0
  try {
    Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value))
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    console.error = () => {}
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.hostname === 'api.stripe.com') {
        stripeCalls += 1
        if (url.pathname === '/v1/accounts') return Response.json({ id: 'acct_policy', charges_enabled: false, payouts_enabled: false, requirements: {} })
        if (url.pathname === '/v1/accounts/acct_policy') return Response.json({
          id: 'acct_policy', country: 'EE', business_type: 'company',
          controller: { requirement_collection: 'stripe', stripe_dashboard: { type: 'express' } },
          metadata: { poeruum_store_id: 'b2000000-0000-4000-8000-000000000001', poeruum_connection: 'dedicated' },
        })
        if (url.pathname === '/v1/account_links') return Response.json({ url: 'https://connect.stripe.com/setup/test-policy' })
        throw new Error(`Unexpected Stripe call: ${url.pathname}`)
      }
      assert(url.origin === env.SUPABASE_URL, 'Unexpected external request')
      if (url.pathname.endsWith('/auth/v1/user')) return Response.json({ id: 'b1000000-0000-4000-8000-000000000001', email: 'test@example.invalid' })
      if (url.pathname.endsWith('/rpc/consume_rate_limit')) return Response.json([{ allowed: true, remaining: 9, retry_after_seconds: 0 }])
      if (url.pathname.endsWith('/rpc/record_application_error')) return Response.json(null)
      if (url.pathname.endsWith('/rpc/require_merchant_email')) {
        policyCalls += 1
        assert(JSON.parse(String(init?.body)).target_user_id === 'b1000000-0000-4000-8000-000000000001', 'Policy checked an untrusted user ID')
        return policy === 'allowed' ? Response.json(null)
          : Response.json({ code: policy === 'blocked' ? '42501' : 'XX000', message: 'Email policy' }, { status: policy === 'blocked' ? 403 : 500 })
      }
      if (url.pathname.endsWith('/stores')) return Response.json(init?.method === 'PATCH' ? { id: 'b2000000-0000-4000-8000-000000000001' } : hasStore ? {
        id: 'b2000000-0000-4000-8000-000000000001', owner_id: 'b1000000-0000-4000-8000-000000000001',
        stripe_account_id: null, settings: { businessName: 'Test OÜ', registryCode: '12345678', businessAddress: 'Tallinn', contactEmail: 'test@example.invalid' }, name: 'Test', slug: 'test',
      } : null)
      throw new Error(`Unexpected database call: ${url.pathname}`)
    }
    const request = (body: unknown, authorized = true) => new Request(`${env.SUPABASE_URL}/functions/v1/test`, {
      method: 'POST', headers: { ...(authorized ? { Authorization: 'Bearer test-user' } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    await import('../supabase/functions/stripe-connect/index.ts')
    const connect = handler!
    assert((await connect(request({ action: 'start' }, false))).status === 401, 'Unauthenticated Connect allowed')
    for (const action of ['start', 'hosted-start', 'hosted-refresh']) {
      for (const mode of ['onboarding', 'management', 'remediation']) {
        const response = await connect(request({ action, mode, userId: 'untrusted-id' }))
        assert(response.status === 403 && (await response.json()).code === 'merchant_email_required', `Blocked ${action}/${mode} did not give an actionable refusal`)
      }
    }
    assert(stripeCalls === 0, 'Blocked account reached Stripe')
    assert((await connect(request({ action: 'status' }))).status === 200, 'Read-only status was blocked')
    policy = 'unavailable'
    for (const action of ['start', 'hosted-start', 'hosted-refresh']) {
      assert((await connect(request({ action }))).status === 500 && stripeCalls === 0, 'Policy outage allowed activation')
    }
    policy = 'allowed'
    const connected = await connect(request({ action: 'hosted-start' }))
    assert(connected.status === 200 && (await connected.json()).url === 'https://connect.stripe.com/setup/test-policy', 'Eligible account could not connect')
    assert(stripeCalls === 3, 'Eligible account did not create, retrieve and open its dedicated account')

    await import('../supabase/functions/stripe-billing-checkout/index.ts')
    const billing = handler!
    stripeCalls = 0
    policy = 'blocked'
    assert((await billing(request({}))).status === 403 && stripeCalls === 0, 'Blocked account reached Billing')
    policy = 'unavailable'
    assert((await billing(request({}))).status === 500 && stripeCalls === 0, 'Billing failed open')
    policy = 'allowed'; hasStore = false
    assert((await billing(request({}))).status === 404, 'Eligible account did not reach store validation')
    assert(policyCalls === 16, 'A protected action skipped its policy check')
  } finally {
    Deno.serve = originalServe; globalThis.fetch = originalFetch; console.error = originalError
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value) }
  }
})
