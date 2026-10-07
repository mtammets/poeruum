import { createClient } from 'npm:@supabase/supabase-js@2'
import { checkRateLimit, rateLimitResponse } from '../_shared/security.ts'
import { validateStoreAnalytics } from '../_shared/store-analytics.ts'

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') ?? ''
  let hostname: string
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:' || url.origin !== origin || url.port) throw new Error('Invalid origin')
    hostname = url.hostname
  } catch { return new Response(null, { status: 403 }) }
  const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' }
  const json = (value: unknown, status: number) => new Response(JSON.stringify(value), { headers, status })
  if (request.method === 'OPTIONS') return new Response(null, { headers, status: 204 })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (/bot|crawler|spider|headless|prerender/i.test(request.headers.get('user-agent') ?? '')) return json({ accepted: false }, 202)
  if (Number(request.headers.get('content-length')) > 16384) return json({ error: 'Batch too large' }, 413)
  try {
    const reader = request.body?.getReader()
    if (!reader) return json({ error: 'Missing events' }, 400)
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > 16384) { await reader.cancel(); return json({ error: 'Batch too large' }, 413) }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    let input: unknown
    try { input = JSON.parse(new TextDecoder().decode(bytes)) }
    catch { return json({ error: 'Invalid JSON' }, 400) }
    const payload = validateStoreAnalytics(input)
    if (!payload) return json({ error: 'Invalid events' }, 400)
    const limit = await checkRateLimit(request, 'store-analytics', 120, 60)
    if (!limit.allowed) return rateLimitResponse(limit.retry_after_seconds, headers)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('POERUUM_SUPABASE_SECRET_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    // The database checks this exact host belongs to this published store,
    // including verified custom domains, before accepting any events.
    const { error } = await admin.rpc('record_store_analytics', {
      target_store_id: payload.store_id, origin_hostname: hostname, events: payload.events,
    })
    if (error?.code === '42501') return json({ error: 'Origin not allowed' }, 403)
    if (error) throw error
    return json({ accepted: true }, 202)
  } catch {
    console.error('Poe analüütikasündmuste salvestamine ebaõnnestus.')
    return json({ error: 'Events were not accepted' }, 500)
  }
})
