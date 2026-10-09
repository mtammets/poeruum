// Exercises the real handler. All network traffic is intercepted; no live accounts are touched.
import { matchingPaymentCheck, savedPaymentDiagnostics, type PaymentStore } from '../supabase/functions/_shared/admin-payment-status.ts'
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const owner = '11000000-0000-4000-8000-000000000001'
const store: PaymentStore = {
  id: '22000000-0000-4000-8000-000000000001', owner_id: owner, settings: { businessName: 'Test Shop', registryCode: '12345678' },
  payment_provider: 'stripe', stripe_account_id: 'acct_fixture', stripe_account_mode: 'live', stripe_connection_type: 'hosted',
  stripe_account_charges_enabled: false, stripe_account_payouts_enabled: false, stripe_account_requirements_due_count: 3,
  stripe_account_requirements_pending_verification: false, stripe_account_requirements_disabled_reason: 'requirements.past_due',
  stripe_account_requirements_deadline: null, stripe_account_requirements_updated_at: '2026-10-09T01:00:00Z', stripe_account_requirement_issues: [],
}
const check = { store_id: store.id, account_id: 'acct_fixture', stripe_mode: 'live', identity: ['company', 'test shop', '12345678'], identity_error: 'Täienda Stripe’is konto omaniku andmeid ja proovi uuesti.', checked_at: '2026-10-09T01:00:00Z' }

Deno.test('saved diagnostics never attach an identity failure to a different seller or account', () => {
  assert(matchingPaymentCheck(store, [check]) === check, 'Current check missing')
  assert(!matchingPaymentCheck({ ...store, stripe_account_id: 'acct_other' }, [check]), 'Old account error reused')
  assert(!matchingPaymentCheck({ ...store, settings: { ...store.settings, businessName: 'Someone else' } }, [check]), 'Old seller error reused')
  const snapshot = savedPaymentDiagnostics(store, check)
  assert(snapshot.dueFields === null && snapshot.dueCount === 3 && snapshot.identityError === check.identity_error, 'Snapshot invents missing fields or loses identity reason')
})

Deno.test('admin payment handler enforces access, returns exact sanitized requirements, and only reads Stripe', async () => {
  const values = { SUPABASE_URL: 'https://payment.example.invalid', POERUUM_SUPABASE_PUBLISHABLE_KEY: 'fixture-public', POERUUM_SUPABASE_SECRET_KEY: 'fixture-secret', STRIPE_SECRET_KEY: 'sk_live_fixture', STRIPE_MODE: 'live', RATE_LIMIT_SALT: 'fixture-salt' }
  const previous = Object.entries(values).map(([key, value]) => { const old = Deno.env.get(key); Deno.env.set(key, value); return [key, old] })
  const originalFetch = globalThis.fetch
  const originalServe = Deno.serve
  let handler: (request: Request) => Promise<Response>
  let role = 'merchant', allowed = true, changed = false, mode = 'live', missing = false, stripeFails = false
  let stripeCalls = 0, databaseCalls = 0
  // @ts-expect-error capture Deno's production handler instead of starting a listener
  Deno.serve = (callback: typeof handler) => { handler = callback }
  const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }))
  globalThis.fetch = (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/auth/v1/user') return json({ id: owner, app_metadata: { role } })
    if (url.hostname === 'api.stripe.com') {
      stripeCalls++
      assert(request.method === 'GET' && url.pathname === '/v1/accounts/acct_fixture', 'Unexpected Stripe mutation or untrusted account ID')
      if (stripeFails) return json({ error: { message: 'Provider failure with private information' } }, 503)
      return json({ id: 'acct_fixture', object: 'account', type: 'none', country: 'EE', business_type: 'company', company: { name: null }, details_submitted: false,
        charges_enabled: false, payouts_enabled: false, email: 'do-not-return@example.invalid', metadata: { secret: 'never-return' },
        requirements: { currently_due: ['company.name', 'external_account', 'tos_acceptance.date', 'bad@field'], past_due: ['company.name'], pending_verification: [], disabled_reason: 'requirements.past_due', errors: [] },
        future_requirements: { currently_due: ['company.tax_id'], past_due: [] },
      })
    }
    databaseCalls++
    if (url.pathname.endsWith('/rpc/consume_rate_limit')) return json([{ allowed, retry_after_seconds: 10 }])
    if (url.pathname.endsWith('/rpc/record_application_error')) return json(null)
    assert(request.method === 'GET', 'Diagnostic endpoint mutated a business record')
    if (url.pathname.endsWith('/stores')) {
      if (url.searchParams.has('id')) return json({ stripe_account_id: changed ? 'acct_replaced' : store.stripe_account_id, stripe_account_mode: mode, settings: store.settings })
      assert(url.searchParams.get('owner_id')?.includes(owner), 'Store lookup not scoped to requested user')
      return json(missing ? [] : [{ ...store, stripe_account_mode: mode }])
    }
    if (url.pathname.endsWith('/store_payment_checks')) return json([check])
    throw new Error(`Unexpected request: ${url.pathname}`)
  }
  try {
    await import('../supabase/functions/admin-payment-status/index.ts')
    const call = (body: unknown, token = true) => handler!(new Request('https://edge.example.invalid', { method: 'POST', headers: token ? { Authorization: 'Bearer fixture' } : {}, body: JSON.stringify(body) }))
    assert((await call({ userId: owner }, false)).status === 401, 'Anonymous access allowed')
    assert((await call({ userId: owner })).status === 403 && databaseCalls === 0 && stripeCalls === 0, 'Merchant accessed private diagnostics')
    role = 'admin'
    assert((await call({ userId: 'not-a-uuid' })).status === 400, 'Invalid target accepted')
    const saved = await (await call({ action: 'snapshot', userIds: [owner] })).json()
    assert(saved.diagnostics[0].identityError === check.identity_error && stripeCalls === 0, 'Saved overview performed live reads or omitted reason')
    const response = await call({ userId: owner, accountId: 'acct_untrusted' })
    assert(response.status === 200 && response.headers.get('Cache-Control') === 'no-store', 'Fresh request failed or cacheable')
    const payload = await response.json()
    assert(payload.diagnostic.dueCount === 3 && payload.diagnostic.dueFields.length === 3 && payload.diagnostic.issues.length === 0, 'Missing fields lost when error list empty')
    assert(payload.diagnostic.futureFields[0] === 'company.tax_id', 'Future requirements not separated')
    assert(payload.diagnostic.transfersStatus === 'unrequested', 'Missing transfer capability considered active')
    assert(!JSON.stringify(payload).includes('never-return') && !JSON.stringify(payload).includes('do-not-return'), 'Raw Stripe identity or metadata leaked')
    changed = true
    assert((await call({ userId: owner })).status === 409, 'Replaced connection received stale diagnosis')
    changed = false; mode = 'test'
    const callsBefore = stripeCalls
    assert((await call({ userId: owner })).status === 409 && stripeCalls === callsBefore, 'Cross-mode Stripe request allowed')
    mode = 'live'; missing = true
    assert((await call({ userId: owner })).status === 404, 'Missing store not handled')
    missing = false; stripeFails = true
    const failed = await call({ userId: owner })
    assert(failed.status === 502 && !(await failed.text()).includes('private information'), 'Raw provider error exposed or failure hidden')
    stripeFails = false; allowed = false
    assert((await call({ userId: owner })).status === 429, 'Rate limit ignored')
  } finally {
    globalThis.fetch = originalFetch; Deno.serve = originalServe
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key!); else Deno.env.set(key!, value) }
  }
})
