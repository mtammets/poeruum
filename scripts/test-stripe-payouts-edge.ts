// Exercise the real handler with fixture networking. Opening the view must
// never create a payout, edit a bank account or change a payout schedule.
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message) }
Deno.test('payout sessions are owner-scoped, narrowly authorized and never move money on open', async test => {
  const values = { SUPABASE_URL: 'https://payouts.example.invalid', POERUUM_SUPABASE_PUBLISHABLE_KEY: 'public-fixture', POERUUM_SUPABASE_SECRET_KEY: 'secret-fixture', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_MODE: 'test', RATE_LIMIT_SALT: 'fixture', STRIPE_INSTANT_PAYOUTS_ENABLED: 'false' }
  const previous = Object.entries(values).map(([key, value]) => { const old = Deno.env.get(key); Deno.env.set(key, value); return [key, old] as const })
  const originalFetch = globalThis.fetch, originalServe = Deno.serve
  let handler: (request: Request) => Promise<Response>
  // @ts-expect-error capture handler without a listener
  Deno.serve = (callback: typeof handler) => { handler = callback }
  const store = { id: '81000000-0000-4000-8000-000000000002', stripe_account_id: 'acct_fixture', stripe_account_mode: 'test' as string | null }
  const account = { id: 'acct_fixture', default_currency: 'eur', payouts_enabled: true,
    controller: { is_controller: true, requirement_collection: 'application', fees: { payer: 'application' } } }
  let authenticated = true, found = true, allowed = true, deleted = false, stripeFails = false
  let reads = 0
  const sessions: URLSearchParams[] = []
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/auth/v1/user') return Response.json(authenticated ? { id: 'owner' } : { message: 'Expired' }, { status: authenticated ? 200 : 401 })
    if (url.pathname.endsWith('/consume_rate_limit')) return Response.json([{ allowed, retry_after_seconds: 60 }])
    if (url.pathname.endsWith('/record_application_error')) return Response.json(null)
    if (url.pathname.endsWith('/stores')) {
      assert(request.method === 'GET' && url.searchParams.get('owner_id') === 'eq.owner' && url.searchParams.get('id') === `eq.${store.id}`, 'Unscoped store read or database mutation')
      return Response.json(found ? store : null)
    }
    if (url.hostname === 'api.stripe.com') {
      if (request.method === 'GET' && url.pathname === '/v1/accounts/acct_fixture') {
        reads++
        if (stripeFails) return Response.json({ error: { message: 'Private Stripe error detail' } }, { status: 400 })
        return Response.json(deleted ? { id: account.id, deleted: true } : account)
      }
      assert(request.method === 'POST' && url.pathname === '/v1/account_sessions', 'Opening payouts mutated money, account or schedule')
      const fields = new URLSearchParams(await request.text())
      assert(fields.get('account') === store.stripe_account_id, 'Account supplied by client was trusted')
      assert([...fields.keys()].every(key => key === 'account' || key.startsWith('components[payouts]')), 'Unrelated account capability was enabled')
      sessions.push(fields)
      return Response.json({ client_secret: 'fixture_secret' })
    }
    throw new Error(`Unexpected request ${request.method} ${url.pathname}`)
  }
  try {
    await import('../supabase/functions/stripe-payouts/index.ts')
    const call = (body: Record<string, unknown> = { storeId: store.id }, token = true) => handler(new Request('https://edge.example.invalid', { method: 'POST', headers: token ? { Authorization: 'Bearer fixture' } : {}, body: JSON.stringify(body) }))
    await test.step('authentication, ownership, rate limits and mode are enforced before creating sessions', async () => {
      assert((await handler(new Request('https://edge.example.invalid'))).status === 405, 'GET accepted')
      assert((await call(undefined, false)).status === 401, 'Anonymous session created')
      authenticated = false; assert((await call()).status === 401, 'Expired session accepted'); authenticated = true
      found = false; assert((await call()).status === 404, 'Foreign owner accepted'); found = true
      allowed = false; assert((await call()).status === 429, 'Rate limit ignored'); allowed = true
      assert((await call({ storeId: 'bad-id' })).status === 400, 'Invalid store ID accepted')
      store.stripe_account_mode = 'live'; assert((await call()).status === 500, 'Mode mismatch accepted')
      store.stripe_account_mode = null; assert((await call()).status === 409, 'Unknown mode accepted'); store.stripe_account_mode = 'test'
      store.stripe_account_id = ''; assert((await call()).status === 409, 'Disconnected account accepted'); store.stripe_account_id = account.id
      assert(reads === 0 && sessions.length === 0, 'Failed authorization reached Stripe')
    })
    await test.step('instant payouts remain off until platform fee pricing has been verified', async () => {
      const response = await call({ storeId: store.id, account: 'acct_attacker', instantPayoutsEnabled: true })
      const data = await response.json()
      assert(response.status === 200 && response.headers.get('Cache-Control') === 'no-store' && data.kind === 'embedded', 'Session missing or cacheable')
      assert(data.instantPayoutsEnabled === false, 'Client bypassed fee configuration')
      const fields = sessions.at(-1)!
      for (const feature of ['edit_payout_schedule', 'standard_payouts', 'external_account_collection']) assert(fields.get(`components[payouts][features][${feature}]`) === 'true', `Missing ${feature}`)
      for (const feature of ['instant_payouts', 'disable_stripe_user_authentication']) assert(fields.get(`components[payouts][features][${feature}]`) === 'false', `Unsafe ${feature}`)
      Deno.env.set('STRIPE_INSTANT_PAYOUTS_ENABLED', 'true')
      const enabled = await (await call()).json()
      assert(enabled.instantPayoutsEnabled && sessions.at(-1)!.get('components[payouts][features][instant_payouts]') === 'true', 'Configured instant payouts not enabled')
      account.default_currency = 'usd'; assert(!(await (await call()).json()).instantPayoutsEnabled, 'Unpriced currency enabled'); account.default_currency = 'eur'
      account.controller.fees.payer = 'account'; assert(!(await (await call()).json()).instantPayoutsEnabled, 'Wrong fee payer enabled'); account.controller.fees.payer = 'application'
    })
    await test.step('restricted accounts retain visibility; Express keeps Stripe-required bank authentication', async () => {
      account.payouts_enabled = false
      assert((await call()).status === 200, 'Restricted account cannot inspect balances/history')
      account.controller.requirement_collection = 'stripe'
      assert((await call()).status === 200, 'Express session rejected')
      assert(sessions.at(-1)!.get('components[payouts][features][external_account_collection]') === 'true', 'Express bank collection disabled contrary to Stripe requirements')
      assert(sessions.at(-1)!.get('components[payouts][features][disable_stripe_user_authentication]') === 'false', 'Stripe authentication disabled')
    })
    await test.step('independent accounts use their Dashboard and deleted/unavailable accounts return safe errors', async () => {
      const count = sessions.length
      account.controller.is_controller = false
      const independent = await (await call()).json()
      assert(independent.kind === 'dashboard' && independent.dashboardUrl === 'https://dashboard.stripe.com/payouts' && !independent.clientSecret, 'Independent account received platform payout powers')
      deleted = true; assert((await call()).status === 409, 'Deleted account accepted'); deleted = false
      stripeFails = true
      const failure = await call()
      assert(failure.status === 500 && !(await failure.text()).includes('Private Stripe'), 'Stripe failure leaked or was ignored')
      assert(sessions.length === count, 'Fallback/error created a session')
    })
  } finally {
    globalThis.fetch = originalFetch; Deno.serve = originalServe
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value) }
  }
})
