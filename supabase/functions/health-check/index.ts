import { createClient } from 'npm:@supabase/supabase-js@2'
import { checkRateLimit, rateLimitResponse } from '../_shared/security.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
}

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(JSON.stringify({ status: 'method_not_allowed' }), { status: 405, headers })
  }

  try {
    const rateLimit = await checkRateLimit(request, 'health-check', 60, 60)
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retry_after_seconds, headers)
    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await admin.from('platform_settings').select('id', { head: true, count: 'exact' }).limit(1)
    if (error) throw error
    const body = JSON.stringify({ status: 'ok', checked_at: new Date().toISOString() })
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers })
  } catch (error) {
    console.error('Tervisekontroll ebaõnnestus.', error)
    return new Response(JSON.stringify({ status: 'degraded' }), { status: 503, headers })
  }
})
