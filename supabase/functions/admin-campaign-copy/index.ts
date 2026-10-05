import { createClient } from 'npm:@supabase/supabase-js@2'
import { CAMPAIGN_ESTIMATE_USD, generateCampaignCopy } from '../_shared/campaign-copy.ts'
import { parseCampaignBrief } from '../_shared/campaign-schema.ts'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sisselogimine on nõutud.' }, 401)
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('POERUUM_SUPABASE_PUBLISHABLE_KEY')!, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)
    if (user.app_metadata?.role !== 'admin') return json({ error: 'Administraatori ligipääs on nõutud.' }, 403)
    const raw = await request.text()
    if (raw.length > 5000) return json({ error: 'Lähteinfo on liiga pikk.' }, 413)
    let body
    try { body = JSON.parse(raw) } catch { return json({ error: 'Vigane päring.' }, 400) }
    const apiKey = Deno.env.get('OPENAI_API_KEY')?.trim()
    if (body?.action === 'capabilities') return json({ available: Boolean(apiKey), estimatedCostUsd: CAMPAIGN_ESTIMATE_USD })
    const brief = parseCampaignBrief(body)
    if (!brief) return json({ error: 'Kontrolli kampaania lähteinfot.' }, 400)
    if (!apiKey) return json({ error: 'AI tekstiloome pole seadistatud. Saad kasutada mallitekste.' }, 503)
    const burst = await checkRateLimit(request, 'admin-campaign-copy', 5, 60, user.id)
    if (!burst.allowed) return rateLimitResponse(burst.retry_after_seconds, cors)
    const daily = await checkRateLimit(request, 'admin-campaign-copy-daily', 100, 86400, user.id)
    if (!daily.allowed) return rateLimitResponse(daily.retry_after_seconds, cors)
    return json({ copy: await generateCampaignCopy(apiKey, brief) })
  } catch (error) {
    await captureEdgeError('admin-campaign-copy', error)
    return json({ error: 'AI tekstide loomine ebaõnnestus. Proovi uuesti või vali mallitekstid.' }, 500)
  }
})
