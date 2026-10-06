// Real Edge handlers and encryption, with all network calls replaced by fixtures.
import { createECDH } from 'node:crypto'
import { parsePushSubscription, processAdminPush, pushNotice, sendAdminPush, validPushEndpoint } from '../supabase/functions/_shared/admin-push.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const keys = createECDH('prime256v1'); keys.generateKeys()
const subscription = { endpoint: 'https://web.push.apple.com/test-only', keys: { p256dh: keys.getPublicKey().toString('base64url'), auth: 'a'.repeat(22) } }
const setup = () => {
  const values = { SUPABASE_URL: 'https://push.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'test-only', RATE_LIMIT_SALT: 'test-only',
    ADMIN_PUSH_VAPID_PUBLIC_KEY: keys.getPublicKey().toString('base64url'), ADMIN_PUSH_VAPID_PRIVATE_KEY: keys.getPrivateKey().toString('base64url') }
  const previous = Object.entries(values).map(([key, value]) => { const before = Deno.env.get(key); Deno.env.set(key, value); return [key, before] })
  return () => { for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key!); else Deno.env.set(key!, value) } }
}

Deno.test('push endpoint validation blocks arbitrary hosts, credentials and redirects; payloads are encrypted', async () => {
  const restore = setup()
  try {
    for (const url of ['http://web.push.apple.com/a', 'https://127.0.0.1/a', 'https://web.push.apple.com.evil.test/a', 'https://user:pass@web.push.apple.com/a', 'https://fcm.googleapis.com:444/a', 'https://example.com/a']) assert(!validPushEndpoint(url), 'Unsafe endpoint accepted')
    assert(parsePushSubscription(subscription), 'Valid subscription rejected')
    assert(!parsePushSubscription({ ...subscription, keys: { auth: 'bad', p256dh: 'bad' } }), 'Malformed keys accepted')
    for (const [status, expected] of [[201, 'sent'], [404, 'gone'], [410, 'gone'], [429, 'retry'], [503, 'retry']] as const) {
      const outcome = await sendAdminPush(subscription, pushNotice('account', 'test-id'), ((_url, init) => {
        assert(init?.redirect === 'error', 'Redirect SSRF protection missing')
        const headers = new Headers(init?.headers)
        assert(headers.get('Authorization')?.startsWith('vapid '), 'VAPID authentication missing')
        assert(headers.get('Content-Encoding') === 'aes128gcm', 'Push payload is not encrypted')
        assert(!new TextDecoder().decode(init?.body as Uint8Array).includes('Poeruum'), 'Plaintext notification sent')
        return Promise.resolve(new Response('', { status }))
      }) as typeof fetch)
      assert(outcome === expected, `HTTP ${status} handled incorrectly`)
    }
  } finally { restore() }
})

Deno.test('push queue completes only its lease and retries transport errors', async () => {
  const job = { id: 'job', lease_token: 'token', subscription_id: 'device', endpoint: subscription.endpoint, ...subscription.keys, kind: 'visit' }
  const calls: Record<string, unknown>[] = []
  const admin = { rpc: (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_admin_push_job') return Promise.resolve({ data: [job] })
    calls.push(args); return Promise.resolve({ data: true })
  } } as unknown as SupabaseClient
  await processAdminPush(admin, () => { throw new Error('private endpoint error') })
  assert(calls[0].outcome === 'retry' && calls[0].target_token === 'token', 'Transport failure lost or lease omitted')
  await processAdminPush(admin, () => Promise.resolve('gone'))
  assert(calls[1].outcome === 'gone', 'Expired subscription was not removed')
})

Deno.test('admin push API authenticates, scopes device operations to the owner and hides private keys', async () => {
  const restore = setup(), originalFetch = globalThis.fetch, originalServe = Deno.serve
  type Handler = (request: Request) => Promise<Response>
  let handler: Handler | undefined, role = 'merchant', rateAllowed = true
  let databaseCalls = 0, deviceExists = false
  let preferences = { visits_enabled: true, accounts_enabled: true }
  const owner = '10000000-0000-4000-8000-000000000001'
  try {
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    globalThis.fetch = (input, init) => {
      const url = new URL(String(input))
      const json = (body: unknown, status = 200, headers = {}) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }))
      if (url.pathname.endsWith('/auth/v1/user')) return json({ id: owner, app_metadata: { role }, aud: 'authenticated' })
      if (url.pathname.endsWith('/consume_rate_limit')) return json([{ allowed: rateAllowed, remaining: 1, retry_after_seconds: 60 }])
      if (url.pathname.endsWith('/admin_push_subscriptions')) {
        databaseCalls++
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)); assert(body.user_id === owner, 'Client controls subscription owner')
          deviceExists = true; preferences = { visits_enabled: body.visits_enabled ?? true, accounts_enabled: body.accounts_enabled ?? true }; return json(null, 201)
        }
        assert(url.searchParams.get('user_id') === `eq.${owner}`, 'Device operation is not scoped to its owner')
        if (init?.method === 'PATCH') { preferences = { ...preferences, ...JSON.parse(String(init.body)) }; return json(null) }
        if (init?.method === 'DELETE') { deviceExists = false; return json(null) }
        if (init?.method === 'HEAD') return Promise.resolve(new Response(null, { headers: { 'Content-Range': '0-0/0' } }))
        return json(deviceExists ? { id: 'device', endpoint: subscription.endpoint, ...subscription.keys, ...preferences } : null)
      }
      throw new Error('Unexpected request')
    }
    await import('../supabase/functions/admin-push/index.ts')
    const call = (body: unknown, token = true) => handler!(new Request('https://edge.example.invalid', { method: 'POST', body: JSON.stringify(body), headers: token ? { Authorization: 'Bearer fixture' } : {} }))
    assert((await call({ action: 'config' }, false)).status === 401, 'Anonymous request authorized')
    assert((await call({ action: 'config' })).status === 403 && databaseCalls === 0, 'Merchant accessed subscriptions')
    role = 'admin'
    const config = await (await call({ action: 'config' })).json()
    assert(config.available && config.publicKey && !JSON.stringify(config).includes(Deno.env.get('ADMIN_PUSH_VAPID_PRIVATE_KEY')!), 'VAPID private key exposed')
    assert((await call({ action: 'subscribe', subscription: { ...subscription, endpoint: 'https://127.0.0.1/internal' } })).status === 400, 'SSRF subscription accepted')
    assert((await call({ action: 'subscribe', subscription, user_id: 'someone-else' })).status === 200 && deviceExists, 'Subscription failed')
    assert((await (await call({ action: 'status', endpoint: subscription.endpoint })).json()).enabled, 'Saved device not restored')
    assert((await call({ action: 'preferences', endpoint: subscription.endpoint, preferences: { visits: 'false', accounts: true } })).status === 400, 'Non-boolean preference accepted')
    assert((await call({ action: 'preferences', endpoint: subscription.endpoint, preferences: { visits: false } })).status === 400, 'Missing preference accepted')
    assert((await call({ action: 'subscribe', subscription, preferences: null })).status === 400, 'Malformed subscribe preferences accepted')
    assert((await call({ action: 'preferences', endpoint: subscription.endpoint, preferences: { visits: false, accounts: true }, user_id: 'someone-else' })).status === 200, 'Preference update failed')
    let status = await (await call({ action: 'status', endpoint: subscription.endpoint })).json()
    assert(status.enabled && !status.preferences.visits && status.preferences.accounts, 'Preferences not restored independently')
    await call({ action: 'subscribe', subscription })
    status = await (await call({ action: 'status', endpoint: subscription.endpoint })).json()
    assert(!status.preferences.visits && status.preferences.accounts, 'Legacy subscription refresh overwrote preferences')
    assert((await call({ action: 'preferences', endpoint: subscription.endpoint, preferences: { visits: false, accounts: false } })).status === 200 && deviceExists, 'Both categories disabled removed subscription')
    assert((await call({ action: 'unsubscribe', endpoint: subscription.endpoint })).status === 200 && !deviceExists, 'Unsubscribe failed')
    assert((await call({ action: 'test', endpoint: subscription.endpoint })).status === 404, 'Test sent to unowned device')
    assert((await call({ action: 'preferences', endpoint: subscription.endpoint, preferences: { visits: true, accounts: true } })).status === 404, 'Preferences updated an unowned device')
    rateAllowed = false
    assert((await call({ action: 'config' })).status === 429, 'Rate limit ignored')
  } finally { globalThis.fetch = originalFetch; Deno.serve = originalServe; restore() }
})
