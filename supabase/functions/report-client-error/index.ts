import { createClient } from 'npm:@supabase/supabase-js@2'
import { checkRateLimit, rateLimitResponse } from '../_shared/security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const textValue = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const rateLimit = await checkRateLimit(request, 'client-error', 10, 60)
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retry_after_seconds, corsHeaders)

    const input = await request.json().catch(() => ({})) as Record<string, unknown>
    const message = textValue(input.message, 500)
    const source = textValue(input.source, 100) || 'browser'
    if (!message) return json({ error: 'Vea kirjeldus puudub.' }, 400)

    const pagePath = (() => {
      try {
        const url = new URL(textValue(input.url, 1000))
        return `${url.origin}${url.pathname}`
      } catch {
        return ''
      }
    })()
    const stack = textValue(input.stack, 4000)
    const fingerprint = await sha256(`${source}|${message.replace(/[0-9a-f-]{20,}/gi, '<id>')}`)
    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await admin.rpc('record_application_error', {
      source_value: `client:${source}`,
      severity_value: 'error',
      fingerprint_value: fingerprint,
      message_value: message,
      context_value: {
        page: pagePath,
        stack,
        user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? '',
      },
    })
    if (error) throw error
    return json({ accepted: true }, 202)
  } catch (error) {
    console.error('Brauserivea vastuvõtmine ebaõnnestus.', error)
    return json({ error: 'Vea vastuvõtmine ebaõnnestus.' }, 500)
  }
})
