// Real Edge handler, fixture networking only. Every Stripe request must be GET.
import { sellerSettings } from '../shared/seller-settings.ts'
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message) }
Deno.test('seller edits verify identity before a single atomic save and preserve active data on failure', async test => {
  const values = { SUPABASE_URL: 'https://seller.example.invalid', POERUUM_SUPABASE_PUBLISHABLE_KEY: 'public-fixture', POERUUM_SUPABASE_SECRET_KEY: 'secret-fixture', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_MODE: 'test', RATE_LIMIT_SALT: 'fixture' }
  const previous = Object.entries(values).map(([key, value]) => { const old = Deno.env.get(key); Deno.env.set(key, value); return [key, old] as const })
  const originalFetch = globalThis.fetch, originalServe = Deno.serve
  let handler: (request: Request) => Promise<Response>
  // @ts-expect-error capture the handler without opening a listener
  Deno.serve = (callback: typeof handler) => { handler = callback }
  const current = sellerSettings({ businessName: 'Test OÜ', registryCode: '12345678', businessAddress: 'Tallinn', contactEmail: 'seller@example.invalid' })
  const store = { id: '81000000-0000-4000-8000-000000000002', owner_id: 'owner', stripe_account_id: 'acct_fixture', stripe_account_mode: 'test', payment_status: 'connected', settings: { ...current, storeAccent: '#123456' } }
  let authenticated = true, found = true, allowed = true, registration: string | undefined = '12345678', accountName = 'Uus OÜ', ready = true, stripeFails = false, stale = false
  let writes: Record<string, unknown>[] = [], stripeReads = 0
  const response = (value: unknown, status = 200) => Response.json(value, { status })
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/auth/v1/user') return response(authenticated ? { id: 'owner' } : { message: 'Expired' }, authenticated ? 200 : 401)
    if (url.pathname.endsWith('/consume_rate_limit')) return response([{ allowed, retry_after_seconds: 60 }])
    if (url.pathname.endsWith('/record_application_error')) return response(null)
    if (url.pathname.endsWith('/stores')) {
      assert(request.method === 'GET' && url.searchParams.get('owner_id') === 'eq.owner' && url.searchParams.get('id') === `eq.${store.id}`, 'Unscoped read or direct database mutation')
      return response(found ? store : null)
    }
    if (url.hostname === 'api.stripe.com') {
      assert(request.method === 'GET' && url.pathname === '/v1/accounts/acct_fixture', 'Stripe mutation or untrusted account')
      stripeReads++
      if (stripeFails) return response({ error: { message: 'Unavailable' } }, 400)
      return response({ id: 'acct_fixture', country: 'EE', business_type: 'company', company: { name: accountName, registration_number: registration }, charges_enabled: ready, payouts_enabled: ready, capabilities: { transfers: 'active' } })
    }
    if (url.pathname.endsWith('/save_store_seller_details')) {
      const body = await request.json()
      if (stale) return response({ message: 'SELLER_CHANGED' }, 400)
      writes.push(body)
      return response({ ...store, settings: { ...store.settings, ...body.seller_value } })
    }
    throw new Error(`Unexpected networking: ${request.method} ${url.pathname}`)
  }
  try {
    await import('../supabase/functions/store-seller-details/index.ts')
    const call = (seller = { ...current, businessName: 'Uus OÜ' }, expected = current, token = true) => handler(new Request('https://edge.example.invalid', { method: 'POST', headers: token ? { Authorization: 'Bearer fixture' } : {}, body: JSON.stringify({ storeId: store.id, seller, expected }) }))
    await test.step('anonymous, expired, foreign-owner and rate-limited requests cannot write', async () => {
      assert((await call(undefined, undefined, false)).status === 401, 'Anonymous request allowed')
      authenticated = false; assert((await call()).status === 401, 'Expired session allowed'); authenticated = true
      found = false; assert((await call()).status === 404, 'Foreign owner allowed'); found = true
      allowed = false; assert((await call()).status === 429, 'Rate limit ignored'); allowed = true
      assert(writes.length === 0 && stripeReads === 0, 'Authorization failure touched Stripe or saved')
    })
    await test.step('invalid drafts, seller transfers and stale drafts never affect active settings', async () => {
      for (const [seller, status] of [[{ ...current, registryCode: '87654321' },409], [{ ...current, businessAddress: '' },400], [{ ...current, vatRegistered: true },400]] as const) {
        assert((await call(seller)).status === status, 'Invalid change accepted')
      }
      assert((await call(undefined, { ...current, businessName: 'Stale' })).status === 409, 'Stale draft accepted')
      assert(writes.length === 0 && stripeReads === 0, 'Invalid draft affected active settings')
    })
    await test.step('name/registry mismatch, missing registry, pending verification and Stripe failures cannot save', async () => {
      accountName = 'Teine OÜ'; assert((await call()).status === 409, 'Name mismatch accepted'); accountName = 'Uus OÜ'
      registration = '87654321'; assert((await call()).status === 409, 'Wrong registration accepted')
      registration = undefined; assert((await call()).status === 409, 'Missing registration accepted'); registration = '12345678'
      ready = false; assert((await call()).status === 409, 'Unverified account accepted'); ready = true
      stripeFails = true; assert((await call()).status === 500, 'Stripe outage accepted'); stripeFails = false
      assert(writes.length === 0, 'Failed verification changed active settings')
    })
    await test.step('verified name and taxes are committed atomically; regular edits do not call Stripe', async () => {
      const result = await call()
      assert(result.status === 200 && result.headers.get('Cache-Control') === 'no-store', 'Verified name rejected or response cacheable')
      assert(writes.length === 1 && writes[0].stripe_ready_value === true && writes[0].account_id_value === store.stripe_account_id && writes[0].owner_id_value === store.owner_id, 'Save missing scoped proof')
      writes = []; const reads = stripeReads
      assert((await call({ ...current, vatRegistered: true, vatNumber: 'EE123456789', contactEmail: 'new@example.invalid' })).status === 200, 'Valid tax/contact update failed')
      assert(writes.length === 1 && writes[0].stripe_ready_value === null && stripeReads === reads, 'Non-identity edit unnecessarily reverified Stripe')
      stale = true; assert((await call()).status === 409, 'Concurrent update failure not returned')
    })
  } finally {
    globalThis.fetch = originalFetch; Deno.serve = originalServe
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value) }
  }
})
