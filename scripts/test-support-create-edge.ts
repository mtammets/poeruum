// Run the real Edge handler with fixture networking. No emails leave this process.
type Handler = (request: Request) => Promise<Response>
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }

type Prepared = { id: string; conversation_id: string; payload: Record<string, unknown>; resend_email_id: string | null; created_at: string; delivery_status?: string; input: Record<string, unknown> }
Deno.test('admin-initiated support authenticates, preserves messages and safely retries email', async (test) => {
  const originalServe = Deno.serve, originalFetch = globalThis.fetch, originalError = console.error
  const adminId = '10000000-0000-4000-8000-000000000001', userId = '20000000-0000-4000-8000-000000000001'
  const requestId = '30000000-0000-4000-8000-000000000001'
  const env = { SUPABASE_URL: 'https://support-test.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'test-secret',
    POERUUM_SUPABASE_PUBLISHABLE_KEY: 'test-public', RATE_LIMIT_SALT: 'test-salt', RESEND_API_KEY: 'test-resend',
    SUPPORT_AGENT_FROM_EMAIL: 'Poeruum <support@example.invalid>', SUPPORT_INBOUND_DOMAIN: 'inbound.example.invalid' }
  const previous = new Map(Object.keys(env).map((key) => [key, Deno.env.get(key)]))
  let handler: Handler | undefined, role = 'merchant', sessionValid = true, allowed = true, recipientExists = true
  let prepareFails = false, sendFails = false, saveFails = false
  const prepared = new Map<string, Prepared>(), providerEmails = new Map<string, string>()
  const providerRequests: { key: string; payload: Record<string, unknown> }[] = []
  const deliveries = new Map<string, Record<string, unknown>>()
  let prepareCalls = 0
  const reset = () => { prepared.clear(); providerEmails.clear(); deliveries.clear(); providerRequests.length = 0; prepareCalls = 0 }
  try {
    Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value))
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    console.error = () => {}
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }))
      if (url.pathname.endsWith('/auth/v1/user')) return sessionValid
        ? json({ id: adminId, app_metadata: { role }, aud: 'authenticated' }) : json({ message: 'Expired' }, 401)
      if (url.pathname.endsWith('/consume_rate_limit')) return json([{ allowed, remaining: 1, retry_after_seconds: 60 }])
      if (url.pathname.endsWith('/record_application_error')) return json(null)
      if (url.pathname.endsWith(`/auth/v1/admin/users/${userId}`)) return recipientExists
        ? json({ id: userId, email: 'recipient@example.invalid', app_metadata: {}, aud: 'authenticated' }) : json({ message: 'Not found' }, 404)
      if (url.pathname.endsWith('/prepare_admin_support_message')) {
        prepareCalls++
        if (prepareFails) return json({ message: 'Database unavailable' }, 503)
        const data = JSON.parse(String(init?.body))
        assert(data.target_user_id === userId && data.sender_id === adminId, 'Untrusted identity reached the database')
        let record = prepared.get(data.request_id)
        if (record && ['target_user_id', 'sender_id', 'message_subject', 'message_body'].some(key => record!.input[key] !== data[key])) {
          return json({ code: '22023', message: 'Request conflict' }, 400)
        }
        if (!record) {
          record = { id: data.request_id, conversation_id: data.request_id, payload: data.email_payload,
            resend_email_id: null, created_at: new Date().toISOString(), input: data }
          prepared.set(data.request_id, record)
        }
        return json(record)
      }
      if (url.origin === 'https://api.resend.com' && url.pathname === '/emails') {
        const key = new Headers(init?.headers).get('Idempotency-Key')!
        const payload = JSON.parse(String(init?.body))
        assert(prepared.has(key.split('/')[1]), 'Email sent before durable conversation creation')
        providerRequests.push({ key, payload })
        if (sendFails) return json({ message: 'Provider unavailable' }, 503)
        if (!providerEmails.has(key)) providerEmails.set(key, `email-${providerEmails.size + 1}`)
        return json({ id: providerEmails.get(key) })
      }
      if (url.pathname.endsWith('/support_messages')) {
        assert(init?.method === 'PATCH', 'Unexpected message mutation')
        const id = url.searchParams.get('id')?.replace(/^eq\./, '')
        assert(id && prepared.has(id), 'Update is not scoped to the saved message')
        const statusSync = url.searchParams.get('delivery_status') === 'eq.sent'
        assert(statusSync || url.searchParams.get('resend_email_id') === 'is.null', 'Retry can overwrite delivery state')
        if (saveFails) return json({ message: 'Database unavailable' }, 503)
        const record = prepared.get(id!)!
        if (statusSync ? record.delivery_status === 'sent' : !record.resend_email_id) Object.assign(record, JSON.parse(String(init?.body)))
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.pathname.endsWith('/email_deliveries')) {
        if (init?.method === 'POST') {
          const delivery = JSON.parse(String(init.body))
          assert(new Headers(init.headers).get('Prefer')?.includes('resolution=ignore-duplicates'), 'Initial log overwrites delivery webhooks')
          assert(delivery.source_application === 'poeruum' && delivery.recipient_email === 'recipient@example.invalid', 'Email log has wrong attribution')
          if (!deliveries.has(delivery.resend_email_id)) deliveries.set(delivery.resend_email_id, delivery)
          return Promise.resolve(new Response(null, { status: 201 }))
        }
        return json(deliveries.get(url.searchParams.get('resend_email_id')!.replace(/^eq\./, '')))
      }
      throw new Error(`Unexpected request: ${url.origin}${url.pathname}`)
    }
    await import('../supabase/functions/support-actions/index.ts')
    const call = (body: Record<string, unknown> = {}, authenticated = true) => handler!(new Request('https://edge.example.invalid', {
      method: 'POST', headers: authenticated ? { Authorization: 'Bearer fixture' } : {},
      body: JSON.stringify({ action: 'admin_create', request_id: requestId, user_id: userId,
        subject: 'Abi poe seadistamisel', body: 'Tere! Kas saan aidata?', ...body }),
    }))
    await test.step('anonymous, expired, merchant and rate-limited requests cannot send', async () => {
      assert((await call({}, false)).status === 401, 'Anonymous send allowed')
      sessionValid = false
      assert((await call()).status === 401, 'Expired session allowed')
      sessionValid = true
      assert((await call({ app_metadata: { role: 'admin' }, sender_id: adminId })).status === 403, 'Merchant escalated privileges')
      role = 'admin'; allowed = false
      assert((await call()).status === 429, 'Rate limit ignored')
      allowed = true
      assert(!prepareCalls && !providerRequests.length, 'Rejected request wrote or sent a message')
    })
    await test.step('validates the recipient, identifiers, subject and message before saving', async () => {
      for (const body of [{ request_id: 'invalid' }, { user_id: 'invalid' }, { subject: ' ' }, { body: '' },
        { subject: 'a'.repeat(161) }, { body: 'a'.repeat(10001) }, { subject: 'Subject\r\nBcc: another@example.invalid' }]) {
        assert((await call(body)).status === 400, 'Invalid input accepted')
      }
      recipientExists = false
      assert((await call()).status === 404, 'Missing recipient accepted')
      recipientExists = true
      assert(!prepareCalls && !providerRequests.length, 'Invalid request was persisted or sent')
    })
    await test.step('uses account email, plain text, original subject and conversation reply address', async () => {
      const response = await call({ email: 'attacker@example.invalid', to: ['attacker@example.invalid'] })
      assert(response.status === 200, 'Admin send failed')
      const result = await response.json()
      assert(result.conversation_id === requestId, 'Wrong conversation returned')
      const { payload, key } = providerRequests[0]
      assert(JSON.stringify(payload.to) === '["recipient@example.invalid"]', 'Recipient came from untrusted input')
      assert(payload.subject === 'Abi poe seadistamisel' && payload.text === 'Tere! Kas saan aidata?' && !payload.html, 'Written message changed')
      assert(payload.reply_to === `Poeruumi klienditugi <vastus+${requestId}@inbound.example.invalid>`, 'Replies do not route to this conversation')
      assert(key === `support-start/${requestId}` && prepared.get(requestId)?.resend_email_id === 'email-1', 'Provider ID was not saved')
      assert((await call()).status === 200 && providerRequests.length === 1, 'Successful replay sent again')
      assert((await call({ body: 'Different message' })).status === 409 && providerRequests.length === 1, 'Changed replay sent a second email')
    })
    await test.step('failed storage never sends, provider failure preserves the conversation for retry', async () => {
      reset(); prepareFails = true
      assert((await call()).status === 500 && !providerRequests.length, 'Email sent without durable message')
      prepareFails = false; sendFails = true
      assert((await call()).status === 502 && prepared.size === 1 && prepared.get(requestId)?.delivery_status === 'failed', 'Provider failure lost message or claimed success')
      sendFails = false
      assert((await call()).status === 200 && prepared.size === 1 && providerEmails.size === 1, 'Retry created duplicates')
      assert(providerRequests[0].key === providerRequests[1].key, 'Retry key changed')
    })
    await test.step('a lost database acknowledgement retries the same provider request without another email', async () => {
      reset(); saveFails = true
      assert((await call()).status === 500 && providerEmails.size === 1, 'Expected ambiguous send')
      saveFails = false
      assert((await call()).status === 200 && providerEmails.size === 1 && prepared.size === 1, 'Ambiguous retry duplicated email')
      assert(JSON.stringify(providerRequests[0]) === JSON.stringify(providerRequests[1]), 'Retry changed the saved payload')
    })
    await test.step('concurrent requests share the provider idempotency key', async () => {
      reset()
      const responses = await Promise.all([call(), call()])
      assert(responses.every(response => response.status === 200) && providerEmails.size === 1 && prepared.size === 1, 'Concurrent request duplicated message')
    })
    await test.step('an early delivery webhook is retained and reconciled into support', async () => {
      reset()
      deliveries.set('email-1', { status: 'delivered', status_updated_at: new Date().toISOString() })
      assert((await call()).status === 200 && prepared.get(requestId)?.delivery_status === 'delivered', 'Early webhook was lost')
      assert((await call()).status === 200 && prepared.get(requestId)?.delivery_status === 'delivered', 'Replay regressed delivered status')
    })
    await test.step('an ambiguous request cannot resend beyond the idempotency window', async () => {
      const record = prepared.get(requestId)!
      record.resend_email_id = null
      record.created_at = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      providerRequests.length = 0
      assert((await call()).status === 409 && !providerRequests.length, 'Expired request was resent')
    })
  } finally {
    Deno.serve = originalServe; globalThis.fetch = originalFetch; console.error = originalError
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value) }
  }
})
