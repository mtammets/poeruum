// Run the actual Edge handler and Supabase SDK with all network calls mocked.
type Handler = (request: Request) => Response | Promise<Response>
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }

Deno.test('campaign copy authorizes admins, caps input and rate, and never leaks upstream errors', async () => {
  const originalServe = Deno.serve, originalFetch = globalThis.fetch
  const values: Record<string, string> = {
    SUPABASE_URL: 'https://campaign-test.example.invalid', POERUUM_SUPABASE_PUBLISHABLE_KEY: 'test-only',
    POERUUM_SUPABASE_SECRET_KEY: 'test-only', OPENAI_API_KEY: 'test-only', RATE_LIMIT_SALT: 'test-only',
  }
  const previous = new Map(Object.keys(values).map((key) => [key, Deno.env.get(key)]))
  let handler: Handler | undefined
  let role = 'merchant', allowed = true, upstreamError = false, modelCalls = 0
  const copy = { headlines: ['Oma looming. Oma pood.', 'Loo oma e-pood.', 'Alusta täna.'], support: 'Loo e-pood telefonist.', cta: 'Alusta tasuta', captionShort: 'Loo oma e-pood.', captionLong: 'Loo oma e-pood otse telefonist.', adTitle: 'Sinu e-pood.' }
  const payload = { goal: 'signup', audience: 'Käsitöötegijad', brief: '', textAmount: 'minimal' }
  try {
    for (const [key, value] of Object.entries(values)) Deno.env.set(key, value)
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    globalThis.fetch = (input, init) => {
      const url = String(input)
      const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
      if (url.endsWith('/auth/v1/user')) return json({ id: '10000000-0000-4000-8000-000000000001', app_metadata: { role }, aud: 'authenticated' })
      if (url.endsWith('/rest/v1/rpc/consume_rate_limit')) return json([{ allowed, remaining: 1, retry_after_seconds: allowed ? 0 : 60 }])
      if (url.endsWith('/rest/v1/rpc/record_application_error')) return json(null)
      if (url === 'https://api.openai.com/v1/responses') {
        modelCalls++
        const sent = JSON.parse(String(init?.body))
        assert(sent.store === false && sent.max_output_tokens === 3000, 'Unbounded or retained AI request')
        return upstreamError ? json({ error: 'private provider detail' }, 500) : json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(copy) }] }] })
      }
      throw new Error(`Unexpected network request: ${url}`)
    }
    await import('../supabase/functions/admin-campaign-copy/index.ts')
    assert(handler, 'Edge handler not registered')
    const call = (body: unknown = payload, auth = true) => handler!(new Request('https://edge.example.invalid', { method: 'POST', headers: auth ? { Authorization: 'Bearer test-token' } : {}, body: JSON.stringify(body) }))
    assert((await call(payload, false)).status === 401, 'Anonymous request accepted')
    assert((await call()).status === 403, 'Merchant request accepted')
    assert(modelCalls === 0, 'AI called before admin authorization')
    role = 'admin'
    assert((await call({ ...payload, brief: 'x'.repeat(701) })).status === 400, 'Oversized brief accepted')
    assert((await call({ ...payload, brief: 'x'.repeat(5001) })).status === 413, 'Oversized request accepted')
    allowed = false
    const limited = await call()
    assert(limited.status === 429 && limited.headers.get('Retry-After') === '60', 'Rate limit missing')
    assert(modelCalls === 0, 'Rate-limited request billed')
    allowed = true
    const response = await call()
    assert(response.status === 200 && (await response.json()).copy.headlines.length === 3, 'Admin copy generation failed')
    upstreamError = true
    const failed = await call()
    assert(failed.status === 500 && !(await failed.text()).includes('private provider'), 'Upstream error leaked')
    Deno.env.delete('OPENAI_API_KEY')
    const capabilities = await call({ action: 'capabilities' })
    assert((await capabilities.json()).available === false, 'Missing AI key reported as available')
    assert((await call()).status === 503, 'Missing key not handled')
  } finally {
    Deno.serve = originalServe; globalThis.fetch = originalFetch
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value) }
  }
})
