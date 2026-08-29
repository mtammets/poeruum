import crypto from 'node:crypto'
import process from 'node:process'

const productionProjectRef = 'foctericixquaogwboqg'
const supabaseUrl = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')
const secretKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '')

if (!supabaseUrl || !secretKey) throw new Error('Puudub ajutise Supabase projekti URL või serverivõti.')
if (supabaseUrl.includes(productionProjectRef)) throw new Error('Outreach DB test keeldub tootmisprojektis töötamast.')

const headers = {
  apikey: secretKey,
  Authorization: `Bearer ${secretKey}`,
  'Content-Type': 'application/json',
}

const request = async (path, options = {}) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...options, headers: { ...headers, ...options.headers } })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${path} vastas ${response.status}: ${JSON.stringify(body)}`)
  return body
}

const rpc = (name, body = {}) => request(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) })
const unique = crypto.randomBytes(4).toString('hex')

const [run] = await request('outreach_runs', {
  method: 'POST',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ run_type: 'import', source_name: 'database-test' }),
})

const candidate = {
  registry_code: `9${String(Date.now()).slice(-7)}`,
  company_name: `Outreach Test ${unique} OÜ`,
  contact_email: `info-${unique}@example.test`,
  website_url: `https://${unique}.example.test/`,
  activity_codes: ['47911'],
  activity_labels: ['Jaemüük posti või Interneti teel'],
}

const imported = await rpc('import_sales_lead_batch', { target_run_id: run.id, candidates: [candidate] })
if (imported.imported !== 1) throw new Error(`Esimene import ei lisanud kontakti: ${JSON.stringify(imported)}`)

const duplicate = await rpc('import_sales_lead_batch', { target_run_id: run.id, candidates: [candidate] })
if (duplicate.duplicates !== 1) throw new Error(`Duplikaati ei tuvastatud: ${JSON.stringify(duplicate)}`)

const disabledClaim = await rpc('claim_next_sales_lead_send')
if (disabledClaim.length !== 0) throw new Error('Väljalülitatud automaatika andis saatmiskontakti.')

await request('outreach_settings?id=eq.true', {
  method: 'PATCH',
  body: JSON.stringify({ enabled: true, daily_limit: 1, subject: 'Test', body: 'Testkiri' }),
})

const [firstClaim] = await rpc('claim_next_sales_lead_send')
if (firstClaim?.contact_email !== candidate.contact_email) throw new Error('Järjekorra claim ei tagastanud testkontakti.')

const completed = await rpc('complete_sales_lead_send', {
  target_lead_id: firstClaim.lead_id,
  target_claim_id: firstClaim.send_claim_id,
  target_resend_email_id: `test-${unique}`,
  target_subject: firstClaim.subject,
  target_body: firstClaim.body,
})
if (completed !== true) throw new Error('Saatmise lõpetamine ebaõnnestus.')

const secondCandidate = {
  ...candidate,
  registry_code: `8${String(Date.now()).slice(-7)}`,
  company_name: `Outreach Test Two ${unique} OÜ`,
  contact_email: `info-two-${unique}@example.test`,
}
await rpc('import_sales_lead_batch', { target_run_id: run.id, candidates: [secondCandidate] })

const cappedClaim = await rpc('claim_next_sales_lead_send')
if (cappedClaim.length !== 0) throw new Error('Päevalimiit ei peatanud teist saatmist.')

const overview = await rpc('outreach_overview')
if (Number(overview.counts.sent_today) !== 1 || Number(overview.counts.queued) !== 1) {
  throw new Error(`Ülevaate loendurid on valed: ${JSON.stringify(overview.counts)}`)
}

console.log(JSON.stringify({ ok: true, imported, duplicate, counts: overview.counts }))
