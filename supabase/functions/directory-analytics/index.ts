import { createClient } from 'npm:@supabase/supabase-js@2'
import { checkRateLimit, rateLimitResponse } from '../_shared/security.ts'
import { validateDirectoryEvents } from '../_shared/directory-analytics.ts'

const origin = 'https://kaubamaja.poeruum.ee'
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
}
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers })

Deno.serve(async (request) => {
  if (request.headers.get('origin') !== origin) return json({ error: 'Origin not allowed' }, 403)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (Number(request.headers.get('content-length')) > 16384) return json({ error: 'Batch too large' }, 413)
  try {
    // Limit streamed bodies too; Content-Length is not guaranteed to be present.
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
    const events = validateDirectoryEvents(input)
    if (!events) return json({ error: 'Invalid events' }, 400)
    const limit = await checkRateLimit(request, 'directory-analytics', 120, 60)
    if (!limit.allowed) return rateLimitResponse(limit.retry_after_seconds, headers)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('POERUUM_SUPABASE_SECRET_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await admin.rpc('record_directory_analytics', { events })
    if (error) throw error
    return json({ accepted: true }, 202)
  } catch {
    console.error('Kaubamaja analüütikasündmuste salvestamine ebaõnnestus.')
    return json({ error: 'Events were not accepted' }, 500)
  }
})
