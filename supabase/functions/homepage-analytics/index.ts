import { createClient } from 'npm:@supabase/supabase-js@2'
import { checkRateLimit, rateLimitResponse } from '../_shared/security.ts'

const allowedOrigins = new Set(['https://poeruum.ee', 'https://www.poeruum.ee'])
const allowedLabels: Record<string, Set<string>> = {
  page_view: new Set(['']),
  engagement: new Set(['']),
  section_view: new Set(['pricing', 'faq']),
  signup_start: new Set(['hero', 'nav', 'mobile_nav', 'pricing_flexible', 'pricing_fixed']),
  demo_open: new Set(['nav', 'mobile_nav', 'phone']),
  faq_open: new Set([
    'pricing',
    'plan_features',
    'requirements',
    'payments',
    'shipping',
    'custom_domain',
    'google',
    'mobile_setup',
    'buyer_account',
    'order_notice',
    'refunds',
    'design',
    'change_plan',
    'support',
  ]),
  account_created: new Set(['']),
}

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const corsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'https://poeruum.ee',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
})

const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders(origin),
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
})

const cleanCampaignValue = (value: unknown, max: number) => String(value ?? '')
  .trim()
  .toLocaleLowerCase('et')
  .replace(/[^a-z0-9äöõüšž._ -]/gi, '')
  .replace(/\s+/g, ' ')
  .slice(0, max)

const cleanReferrerHost = (value: unknown) => {
  const host = String(value ?? '').trim().toLowerCase().slice(0, 120)
  return /^(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::\d{1,5})?$/.test(host) ? host : ''
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin)
  if (!origin || !allowedOrigins.has(origin)) return json({ error: 'Origin not allowed' }, 403, origin)

  try {
    const rateLimit = await checkRateLimit(request, 'homepage-analytics', 120, 60)
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retry_after_seconds, corsHeaders(origin))

    const input = await request.json().catch(() => ({})) as Record<string, unknown>
    const sessionId = String(input.session_id ?? '').trim()
    const eventName = String(input.event_name ?? '').trim()
    const eventLabel = String(input.event_label ?? '').trim()
    const audience = String(input.audience ?? '')
    const deviceType = String(input.device_type ?? '')
    const engagedSeconds = Number(input.engaged_seconds ?? 0)

    if (!/^[a-zA-Z0-9-]{16,64}$/.test(sessionId)) {
      return json({ error: 'Invalid session identifier' }, 400, origin)
    }
    if (!allowedLabels[eventName]?.has(eventLabel)) {
      return json({ error: 'Invalid analytics event' }, 400, origin)
    }
    if (!['anonymous', 'merchant'].includes(audience) || !['mobile', 'tablet', 'desktop'].includes(deviceType)) {
      return json({ error: 'Invalid analytics context' }, 400, origin)
    }
    if (eventName === 'engagement' && (!Number.isInteger(engagedSeconds) || engagedSeconds < 1 || engagedSeconds > 1_800)) {
      return json({ error: 'Invalid engagement duration' }, 400, origin)
    }

    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const analyticsContext = {
      target_session_id: sessionId,
      target_audience: audience,
      target_referrer_host: cleanReferrerHost(input.referrer_host),
      target_utm_source: cleanCampaignValue(input.utm_source, 80),
      target_utm_medium: cleanCampaignValue(input.utm_medium, 80),
      target_utm_campaign: cleanCampaignValue(input.utm_campaign, 100),
      target_device_type: deviceType,
    }
    const { error } = eventName === 'engagement'
      ? await admin.rpc('record_homepage_engagement', {
        ...analyticsContext,
        target_engaged_seconds: engagedSeconds,
      })
      : await admin.from('homepage_analytics_events').upsert({
        session_id: sessionId,
        event_name: eventName,
        event_label: eventLabel,
        audience,
        referrer_host: analyticsContext.target_referrer_host,
        utm_source: analyticsContext.target_utm_source,
        utm_medium: analyticsContext.target_utm_medium,
        utm_campaign: analyticsContext.target_utm_campaign,
        device_type: deviceType,
        ...(eventName === 'page_view' ? { engaged_seconds: 0 } : {}),
      }, {
        onConflict: 'session_id,event_name,event_label',
        ignoreDuplicates: true,
      })
    if (error) throw error

    return json({ accepted: true }, 202, origin)
  } catch (error) {
    console.error('Avalehe analüütikasündmuse salvestamine ebaõnnestus.', error)
    return json({ error: 'Analytics event was not accepted' }, 500, origin)
  }
})
