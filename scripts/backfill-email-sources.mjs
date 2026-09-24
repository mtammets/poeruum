import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import { isPoeruumSender, normalizeSenderEmail } from '../supabase/functions/_shared/email-source.mjs'

config({ path: '.env', quiet: true })

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}
const projectUrl = required('VITE_SUPABASE_URL').replace(/\/$/, '')
const configuredSenders = ['RESEND_FROM_EMAIL', 'OUTREACH_FROM_EMAIL', 'SUPPORT_AGENT_FROM_EMAIL']
  .map((name) => process.env[name] || '')
const allowedSenders = [...new Set(['teavitused@send.poeruum.ee', ...configuredSenders]
  .map(normalizeSenderEmail).filter(Boolean))].sort()
const admin = createClient(projectUrl, process.env.SUPABASE_SECRET_KEY || required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket },
})
const [mode = '--audit', suppliedFile] = process.argv.slice(2)
if (!['--audit', '--apply'].includes(mode)) throw new Error('Kasuta --audit [fail] või --apply fail.')
if (mode === '--apply' && !suppliedFile) throw new Error('--apply vajab eelnevalt loodud auditifaili.')
const auditFile = path.resolve(suppliedFile || `.local-backups/email-sources-${new Date().toISOString().replaceAll(':', '-')}.json`)

if (mode === '--audit') {
  const apiKey = required('RESEND_API_KEY')
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from('email_deliveries').select('*')
      .order('resend_email_id').range(offset, offset + 999)
    if (error) throw new Error(error.message)
    rows.push(...data)
    if (data.length < 1000) break
  }
  const audit = { project_url: projectUrl, created_at: new Date().toISOString(), allowed_senders: allowedSenders, original_rows: rows, results: [] }
  await mkdir(path.dirname(auditFile), { recursive: true, mode: 0o700 })
  const save = () => writeFile(auditFile, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600 })
  await save()
  for (const row of rows) {
    let response
    for (let attempt = 0; attempt < 4; attempt++) {
      // Keep below the provider's shared request rate. Never send an email.
      await delay(650 * (attempt + 1))
      response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(row.resend_email_id)}`, {
        headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000),
      })
      if (response.status !== 429 && response.status < 500) break
    }
    if ([401, 403].includes(response.status)) throw new Error(`Resendi lugemisõigus puudub (${response.status}).`)
    const result = { resend_email_id: row.resend_email_id, lookup_status: response.status, sender_email: null, source_application: null }
    if (response.ok) {
      const email = await response.json()
      const recipients = [email.to, email.cc, email.bcc]
        .flatMap((addresses) => Array.isArray(addresses) ? addresses : []).map(normalizeSenderEmail)
      const recipient = normalizeSenderEmail(row.recipient_email)
      const sender = normalizeSenderEmail(email.from)
      // Establish provenance by provider ID and recipient, never by subject or tags.
      if (email.id === row.resend_email_id && recipient && recipients.includes(recipient) && sender) {
        result.sender_email = sender
        result.source_application = isPoeruumSender(sender, configuredSenders) ? 'poeruum' : 'external'
      }
    }
    audit.results.push(result)
    await save()
    if (audit.results.length % 25 === 0 || audit.results.length === rows.length) {
      console.log(JSON.stringify({ checked: audit.results.length, total: rows.length }))
    }
  }
  const counts = audit.results.reduce((totals, item) => {
    const source = item.source_application || 'unverified'
    totals[source] = (totals[source] || 0) + 1
    return totals
  }, {})
  console.log(JSON.stringify({ audit_file: auditFile, counts }))
} else {
  const audit = JSON.parse(await readFile(auditFile, 'utf8'))
  if (audit.project_url !== projectUrl || JSON.stringify(audit.allowed_senders) !== JSON.stringify(allowedSenders)) {
    throw new Error('Auditifaili projekt või lubatud saatjad ei vasta praegusele seadistusele.')
  }
  const originals = new Map(audit.original_rows.map((row) => [row.resend_email_id, row]))
  let updated = 0
  for (const result of audit.results) {
    const original = originals.get(result.resend_email_id)
    const sender = normalizeSenderEmail(result.sender_email)
    if (!original || !normalizeSenderEmail(original.recipient_email) || !sender || !result.source_application || result.lookup_status !== 200) continue
    const expectedSource = isPoeruumSender(sender, configuredSenders) ? 'poeruum' : 'external'
    if (result.source_application !== expectedSource) throw new Error('Auditifaili päritolumärge on vastuoluline.')
    let query = admin.from('email_deliveries').update({ sender_email: sender, source_application: expectedSource })
      .eq('resend_email_id', result.resend_email_id).eq('recipient_email', original.recipient_email)
      .is('sender_email', null)
    query = original.source_application == null ? query.is('source_application', null) : query.eq('source_application', original.source_application)
    const { data, error } = await query.select('resend_email_id')
    if (error) throw new Error(error.message)
    updated += data.length
  }
  console.log(JSON.stringify({ updated, audit_file: auditFile }))
}
