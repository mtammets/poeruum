import { createClient } from 'npm:@supabase/supabase-js@2'

type RateLimitResult = {
  allowed: boolean
  remaining: number
  retry_after_seconds: number
}

type ErrorSeverity = 'warning' | 'error' | 'critical'

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const adminClient = () => createClient(
  requiredEnv('SUPABASE_URL'),
  requiredEnv('POERUUM_SUPABASE_SECRET_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const requestIdentity = (request: Request) => {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || forwarded
    || 'unknown'
  if (ip !== 'unknown') return ip
  return `unknown|${request.headers.get('user-agent')?.slice(0, 200) || 'unknown'}`
}

export const checkRateLimit = async (
  request: Request,
  action: string,
  limit: number,
  windowSeconds: number,
  identity?: string,
) => {
  const keyHash = await sha256(`${requiredEnv('RATE_LIMIT_SALT')}|${identity || requestIdentity(request)}`)
  const { data, error } = await adminClient().rpc('consume_rate_limit', {
    action_value: action,
    key_hash_value: keyHash,
    limit_value: limit,
    window_seconds_value: windowSeconds,
  })
  if (error) throw error
  const result = (data?.[0] ?? null) as RateLimitResult | null
  if (!result) throw new Error('Rate-limit kontroll ei tagastanud tulemust.')
  return result
}

export const rateLimitResponse = (
  retryAfterSeconds: number,
  corsHeaders: Record<string, string> = {},
) => new Response(JSON.stringify({
  error: 'Liiga palju päringuid. Palun proovi veidi hiljem uuesti.',
}), {
  status: 429,
  headers: {
    ...corsHeaders,
    'Content-Type': 'application/json',
    'Retry-After': String(Math.max(1, retryAfterSeconds)),
    'Cache-Control': 'no-store',
  },
})

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return String(error || 'Unknown application error')
}

export const captureEdgeError = async (
  source: string,
  error: unknown,
  context: Record<string, unknown> = {},
  severity: ErrorSeverity = 'error',
) => {
  try {
    const message = errorMessage(error).slice(0, 500)
    const fingerprint = await sha256(`${source}|${message.replace(/[0-9a-f-]{20,}/gi, '<id>')}`)
    const safeContext = Object.fromEntries(
      Object.entries(context)
        .filter(([key]) => !/(authorization|token|secret|password|email|name|address)/i.test(key))
        .slice(0, 20),
    )
    await adminClient().rpc('record_application_error', {
      source_value: source.slice(0, 100),
      severity_value: severity,
      fingerprint_value: fingerprint,
      message_value: message,
      context_value: safeContext,
    })
  } catch (monitoringError) {
    console.error('Veaseire sündmuse salvestamine ebaõnnestus.', monitoringError)
  }
}
