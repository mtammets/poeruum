// Execute the real handler with fixture networking; never send mail or touch production.
type Handler = (request: Request) => Promise<Response>
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }

Deno.test('support deletion is admin-only, scoped, retryable and cleans up private attachments', async (test) => {
  const originalServe = Deno.serve, originalFetch = globalThis.fetch, originalError = console.error
  const env = { SUPABASE_URL: 'https://support-test.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'test-secret',
    POERUUM_SUPABASE_PUBLISHABLE_KEY: 'test-public', RATE_LIMIT_SALT: 'test-salt' }
  const previous = new Map(Object.keys(env).map((key) => [key, Deno.env.get(key)]))
  const target = '10000000-0000-4000-8000-000000000001'
  let handler: Handler | undefined, role = 'merchant', validSession = true, allowed = true
  let storageFails = false, databaseFails = false, lookupFails = false, deleted = false
  let attachments = ['external/thread/one.pdf', 'external/thread/one.pdf', 'account/shared.png']
  const reads: number[] = [], removals: string[][] = [], deletes: string[] = []
  const reset = () => { reads.length = 0; removals.length = 0; deletes.length = 0; deleted = false }
  try {
    Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value))
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    console.error = () => {}
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }))
      if (url.pathname.endsWith('/auth/v1/user')) return validSession
        ? json({ id: 'admin-fixture', app_metadata: { role }, aud: 'authenticated' }) : json({ message: 'Expired' }, 401)
      if (url.pathname.endsWith('/consume_rate_limit')) return json([{ allowed, remaining: 1, retry_after_seconds: 60 }])
      if (url.pathname.endsWith('/record_application_error')) return json(null)
      if (url.pathname.endsWith('/support_messages')) {
        const scope = url.searchParams.get('conversation_id')
        assert(scope === `eq.${target}` || scope === `neq.${target}`, 'Attachment lookup is not scoped')
        assert(init?.method !== 'DELETE', 'Messages should cascade, not be deleted independently')
        const offset = Number(url.searchParams.get('offset') ?? 0)
        if (scope === `neq.${target}`) {
          assert(url.searchParams.has('attachment_path'), 'Shared-file query is not restricted to candidates')
          return json(offset ? [] : [{ attachment_path: 'account/shared.png' }])
        }
        reads.push(offset)
        if (lookupFails) return json({ message: 'Attachment lookup unavailable' }, 503)
        return json((deleted ? [] : attachments).slice(offset, offset + 100).map(attachment_path => ({ attachment_path })))
      }
      if (url.pathname.endsWith('/storage/v1/object/support-attachments')) {
        assert(init?.method === 'DELETE', 'Unexpected storage action')
        const paths = JSON.parse(String(init?.body)).prefixes as string[]
        assert(paths.length <= 100 && paths.every(path => attachments.includes(path)), 'Arbitrary attachment path removed')
        assert(!paths.includes('account/shared.png'), 'Shared attachment removed')
        removals.push(paths)
        return storageFails ? json({ message: 'Storage unavailable' }, 503) : json(paths.map(name => ({ name })))
      }
      if (url.pathname.endsWith('/support_conversations')) {
        assert(init?.method === 'DELETE' && url.searchParams.get('id') === `eq.${target}`, 'Deletion is not scoped to the target')
        deletes.push(target)
        if (databaseFails) return json({ message: 'Database unavailable' }, 503)
        deleted = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      throw new Error(`Unexpected request: ${url.origin}${url.pathname}`)
    }
    await import('../supabase/functions/support-actions/index.ts')
    const call = (body: Record<string, unknown> = {}, authenticated = true) => handler!(new Request('https://edge.example.invalid', {
      method: 'POST', headers: authenticated ? { Authorization: 'Bearer fixture' } : {},
      body: JSON.stringify({ action: 'delete', conversation_id: target, ...body }),
    }))
    await test.step('anonymous, expired, merchant and rate-limited requests cannot delete', async () => {
      assert((await call({}, false)).status === 401, 'Anonymous deletion allowed')
      validSession = false
      assert((await call()).status === 401, 'Expired session allowed')
      validSession = true
      assert((await call({ app_metadata: { role: 'admin' }, user_id: 'admin-fixture' })).status === 403, 'Merchant escalated privileges')
      role = 'admin'; allowed = false
      assert((await call()).status === 429, 'Rate limit ignored')
      allowed = true
      assert((await call({ conversation_id: 'not-a-uuid' })).status === 400, 'Invalid target accepted')
      assert(!reads.length && !removals.length && !deletes.length, 'Rejected request accessed conversation data')
    })
    await test.step('delete removes only target attachments and is safe to retry', async () => {
      assert((await call({ attachment_path: 'another-store/private.pdf' })).status === 200, 'Admin delete failed')
      assert(deleted && removals.length === 1 && removals[0].length === 1, 'Duplicate/shared attachment handling failed')
      assert((await call()).status === 200 && removals.length === 1, 'Repeat delete is not idempotent')
    })
    await test.step('all attachments are paginated and removed in bounded batches', async () => {
      reset(); attachments = Array.from({ length: 205 }, (_, index) => `external/thread/${index}.pdf`)
      assert((await call()).status === 200, 'Large conversation delete failed')
      assert(reads.join(',') === '0,100,200' && removals.flat().length === 205 && deletes.length === 1, 'Attachments were skipped')
    })
    await test.step('failed lookup or storage cleanup preserves the conversation for retry', async () => {
      reset(); lookupFails = true
      assert((await call()).status === 500 && !deletes.length && !removals.length, 'Lookup failure deleted data')
      lookupFails = false; storageFails = true
      assert((await call()).status === 500 && !deletes.length && !deleted, 'Storage failure deleted the conversation')
      storageFails = false
      assert((await call()).status === 200 && deleted, 'Failed operation could not be retried')
    })
    await test.step('database deletion failure is reported rather than claiming success', async () => {
      reset(); attachments = []; databaseFails = true
      assert((await call()).status === 500 && !deleted, 'Database failure claimed success')
      databaseFails = false
      assert((await call()).status === 200 && deleted, 'Database failure could not be retried')
    })
  } finally {
    Deno.serve = originalServe; globalThis.fetch = originalFetch; console.error = originalError
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value) }
  }
})
