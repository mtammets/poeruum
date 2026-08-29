import { createClient } from 'npm:@supabase/supabase-js@2'
import { captureEdgeError } from '../_shared/security.ts'
import { renderLeadText } from '../_shared/lead-email.ts'

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

const textValue = (value: unknown, max: number) => String(value ?? '')
  .replace(/\p{Cc}/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)

const multilineValue = (value: unknown, max: number) => String(value ?? '')
  .replace(/\r/g, '')
  .replace(/[^\S\n]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, max)

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const createAdminClient = () => createClient(
  requiredEnv('SUPABASE_URL'),
  requiredEnv('POERUUM_SUPABASE_SECRET_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
)

type AdminClient = ReturnType<typeof createAdminClient>

const getAdminUser = async (request: Request) => {
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const client = createClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('POERUUM_SUPABASE_PUBLISHABLE_KEY'),
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || user?.app_metadata?.role !== 'admin') return null
  return user
}

const hasAutomationAccess = (request: Request) => {
  const expected = `Bearer ${requiredEnv('OUTREACH_AUTOMATION_SECRET')}`
  return request.headers.get('Authorization') === expected
}

const sendEmail = async (payload: Record<string, unknown>, idempotencyKey: string) => {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'User-Agent': 'poeruum-outreach-automation/1.0',
    },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string }
  if (!response.ok || !result.id) throw new Error(result.message || `Resend vastas ${response.status}.`)
  return result.id
}

type SendClaim = {
  lead_id: string
  company_name: string
  contact_email: string
  subject: string
  body: string
  unsubscribe_token: string
  send_claim_id: string
  daily_limit: number
  used_today: number
}

const senderConfiguration = () => {
  const senderName = textValue(Deno.env.get('OUTREACH_SENDER_NAME'), 80) || 'Marek'
  const configuredSender = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || ''
  const senderAddress = configuredSender.match(/<([^<>\s@]+@[^<>\s@]+)>/)?.[1]
    || configuredSender.match(/^[^\s@]+@[^\s@]+$/)?.[0]
    || 'teavitused@send.poeruum.ee'
  const from = Deno.env.get('OUTREACH_FROM_EMAIL')?.trim() || `${senderName} <${senderAddress}>`
  const bcc = Deno.env.get('OUTREACH_BCC_EMAIL')?.trim() || ''
  const replyTo = Deno.env.get('OUTREACH_REPLY_TO')?.trim()
    || bcc
    || Deno.env.get('SUPPORT_PUBLIC_EMAIL')?.trim()
    || 'info@poeruum.ee'
  return { senderName, from, replyTo, bcc }
}

const executeSendRun = async (admin: AdminClient, runId: string) => {
  const sender = senderConfiguration()
  let sent = 0
  let failed = 0
  let attempted = 0
  let dailyLimit = 50

  while (attempted < 50) {
    const { data, error } = await admin.rpc('claim_next_sales_lead_send')
    if (error) throw error
    const claim = (Array.isArray(data) ? data[0] : data) as SendClaim | null
    if (!claim) break
    attempted += 1
    dailyLimit = Number(claim.daily_limit) || dailyLimit

    const renderedBody = renderLeadText({ body: claim.body, senderName: sender.senderName })
    const idempotencyKey = `poeruum-lead-${claim.lead_id}-${claim.send_claim_id}`

    try {
      const resendEmailId = await sendEmail({
        from: sender.from,
        to: [claim.contact_email],
        ...(sender.bcc ? { bcc: [sender.bcc] } : {}),
        reply_to: sender.replyTo,
        subject: claim.subject,
        text: renderedBody,
        tags: [
          { name: 'email_type', value: 'lead_outreach' },
          { name: 'lead_id', value: claim.lead_id },
        ],
      }, idempotencyKey)

      const { data: completed, error: completeError } = await admin.rpc('complete_sales_lead_send', {
        target_lead_id: claim.lead_id,
        target_claim_id: claim.send_claim_id,
        target_resend_email_id: resendEmailId,
        target_subject: claim.subject,
        target_body: claim.body,
      })
      if (completeError) throw completeError
      if (completed !== true) throw new Error('Saadetud kirja olekut ei õnnestunud kinnitada.')
      sent += 1
    } catch (sendError) {
      failed += 1
      const { error: releaseError } = await admin.rpc('release_sales_lead_send', {
        target_lead_id: claim.lead_id,
        target_claim_id: claim.send_claim_id,
        error_message: errorMessage(sendError),
      })
      if (releaseError) {
        await captureEdgeError('lead-outreach-release', releaseError, { lead_id: claim.lead_id }, 'critical')
      }
    }
  }

  const { error: runError } = await admin.from('outreach_runs').update({
    status: 'completed',
    sent_count: sent,
    failed_count: failed,
    details: { attempted, daily_limit: dailyLimit },
    completed_at: new Date().toISOString(),
  }).eq('id', runId).eq('status', 'running')
  if (runError) throw runError

  return { run_id: runId, attempted, sent, failed, daily_limit: dailyLimit }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let activeRunId: string | null = null
  try {
    const input = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = textValue(input.action, 40)
    const automationAction = ['start-import', 'import-batch', 'complete-import', 'fail-import', 'run-send'].includes(action)
    const automationAccess = automationAction && hasAutomationAccess(request)
    const adminUser = automationAccess ? null : await getAdminUser(request)
    if (!automationAccess && !adminUser) return json({ error: 'Administraatori ligipääs puudub.' }, 403)

    const admin = createAdminClient()

    if (action === 'overview') {
      const { data, error } = await admin.rpc('outreach_overview')
      if (error) throw error
      return json({ ok: true, ...((data ?? {}) as Record<string, unknown>) })
    }

    if (action === 'save-settings') {
      const enabled = input.enabled === true
      const dailyLimit = Math.floor(Number(input.daily_limit))
      const subject = textValue(input.subject, 160)
      const body = multilineValue(input.body, 5000)
      if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 50) {
        return json({ error: 'Päevane limiit peab olema 1 kuni 50.' }, 400)
      }
      if (!subject || !body) return json({ error: 'Kirja teema ja sisu peavad olema täidetud.' }, 400)
      const { error } = await admin.from('outreach_settings').update({
        enabled,
        daily_limit: dailyLimit,
        subject,
        body,
        updated_by: adminUser?.id ?? null,
      }).eq('id', true)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'suppress') {
      const leadId = textValue(input.lead_id, 60)
      if (!uuidPattern.test(leadId)) return json({ error: 'Kontakti ei leitud.' }, 400)
      const { data: lead, error: leadError } = await admin.from('sales_leads')
        .select('id,contact_email,status')
        .eq('id', leadId)
        .maybeSingle()
      if (leadError) throw leadError
      if (!lead?.contact_email) return json({ error: 'Kontakti ei leitud.' }, 404)
      const { error: suppressionError } = await admin.from('lead_suppressions').upsert({
        email: String(lead.contact_email).toLowerCase(),
        reason: 'manual',
        lead_id: lead.id,
        source: 'admin',
      }, { onConflict: 'email' })
      if (suppressionError) throw suppressionError
      const { error: updateError } = await admin.from('sales_leads').update({
        status: 'unsubscribed',
        suppressed_at: new Date().toISOString(),
        suppression_reason: 'manual',
        updated_by: adminUser?.id ?? null,
      }).eq('id', lead.id).neq('status', 'sending')
      if (updateError) throw updateError
      return json({ ok: true })
    }

    if (action === 'start-import') {
      const sourceUpdatedAt = textValue(input.source_updated_at, 40)
      const { data: run, error } = await admin.from('outreach_runs').insert({
        run_type: 'import',
        source_name: 'e-business-register-open-data',
        source_updated_at: sourceUpdatedAt || null,
      }).select('id').single()
      if (error || !run) throw error || new Error('Imporditööd ei loodud.')
      return json({ ok: true, run_id: run.id })
    }

    if (action === 'import-batch') {
      const runId = textValue(input.run_id, 60)
      const candidates = input.candidates
      if (!uuidPattern.test(runId) || !Array.isArray(candidates) || candidates.length < 1 || candidates.length > 500) {
        return json({ error: 'Vigane impordipakk.' }, 400)
      }
      const { data, error } = await admin.rpc('import_sales_lead_batch', {
        target_run_id: runId,
        candidates,
      })
      if (error) throw error
      return json({ ok: true, ...((data ?? {}) as Record<string, unknown>) })
    }

    if (action === 'complete-import') {
      const runId = textValue(input.run_id, 60)
      if (!uuidPattern.test(runId)) return json({ error: 'Imporditööd ei leitud.' }, 400)
      const scannedCount = Math.max(0, Math.floor(Number(input.scanned_count) || 0))
      const { error } = await admin.from('outreach_runs').update({
        status: 'completed',
        scanned_count: scannedCount,
        completed_at: new Date().toISOString(),
      }).eq('id', runId).eq('status', 'running').eq('run_type', 'import')
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'fail-import') {
      const runId = textValue(input.run_id, 60)
      if (!uuidPattern.test(runId)) return json({ error: 'Imporditööd ei leitud.' }, 400)
      const { error } = await admin.from('outreach_runs').update({
        status: 'failed',
        error_message: textValue(input.error_message, 1000) || 'Import ebaõnnestus.',
        completed_at: new Date().toISOString(),
      }).eq('id', runId).eq('status', 'running').eq('run_type', 'import')
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'run-send' || action === 'run-now') {
      const { data: run, error } = await admin.from('outreach_runs').insert({
        run_type: 'send',
        source_name: action === 'run-now' ? 'admin' : 'schedule',
      }).select('id').single()
      if (error || !run) throw error || new Error('Saatmistööd ei loodud.')
      activeRunId = run.id
      return json({ ok: true, ...await executeSendRun(admin, run.id) })
    }

    return json({ error: 'Tundmatu tegevus.' }, 400)
  } catch (error) {
    if (activeRunId) {
      try {
        await createAdminClient().from('outreach_runs').update({
          status: 'failed',
          error_message: errorMessage(error).slice(0, 1000),
          completed_at: new Date().toISOString(),
        }).eq('id', activeRunId).eq('status', 'running')
      } catch {
        // The original failure is captured below.
      }
    }
    await captureEdgeError('lead-outreach', error)
    console.error(error)
    return json({ error: errorMessage(error) }, 500)
  }
})
