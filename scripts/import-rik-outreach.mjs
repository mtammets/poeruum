import { spawn } from 'node:child_process'
import process from 'node:process'
import { createInterface } from 'node:readline'
import {
  isOutreachActivityCode,
  normalizeOutreachWebsite,
  selectOutreachEmail,
} from '../shared/outreach-candidate.mjs'

const zipPath = process.argv.find((argument) => !argument.startsWith('--') && argument !== process.argv[0] && argument !== process.argv[1])
const dryRun = process.argv.includes('--dry-run')
const batchSize = 250

if (!zipPath) {
  console.error('Usage: node scripts/import-rik-outreach.mjs <general-data.json.zip> [--dry-run]')
  process.exit(1)
}

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const automationSecret = String(process.env.OUTREACH_AUTOMATION_SECRET || '')
if (!dryRun && (!supabaseUrl || !automationSecret)) {
  console.error('SUPABASE_URL (või VITE_SUPABASE_URL) ja OUTREACH_AUTOMATION_SECRET on kohustuslikud.')
  process.exit(1)
}

const endpoint = `${supabaseUrl}/functions/v1/lead-outreach`

const requestAutomation = async (body, attempts = 3) => {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${automationSecret}`,
          'Content-Type': 'application/json',
          'User-Agent': 'poeruum-rik-import/1.0',
        },
        body: JSON.stringify(body),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.error) throw new Error(result.error || `Server vastas ${response.status}.`)
      return result
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }
  throw lastError
}

const parseLineValue = (line) => {
  const separatorIndex = line.indexOf(':')
  return JSON.parse(line.slice(separatorIndex + 1).replace(/,$/, ''))
}

let runId = null
let entity = null
let section = null
let contact = null
let activity = null
let pendingCandidates = []
const samples = []
const totals = {
  scanned: 0,
  registered: 0,
  targetActivity: 0,
  withEligibleEmail: 0,
  uploaded: 0,
  imported: 0,
  duplicates: 0,
  excludedByServer: 0,
}

const flushBatch = async () => {
  if (!pendingCandidates.length) return
  const candidates = pendingCandidates
  pendingCandidates = []
  if (dryRun) return
  const result = await requestAutomation({ action: 'import-batch', run_id: runId, candidates })
  totals.uploaded += candidates.length
  totals.imported += Number(result.imported || 0)
  totals.duplicates += Number(result.duplicates || 0)
  totals.excludedByServer += Number(result.excluded || 0)
  console.log(`Import: ${totals.uploaded} kandidaati saadetud, ${totals.imported} uut.`)
}

const finishContact = () => {
  if (!entity || !contact) return
  if (contact.endDate == null) {
    if (contact.type === 'EMAIL' && contact.value) entity.emails.add(String(contact.value))
    if (contact.type === 'WWW' && contact.value) entity.websites.add(String(contact.value))
  }
  contact = null
}

const finishActivity = () => {
  if (!entity || !activity) return
  if (activity.endDate == null && isOutreachActivityCode(activity.code)) {
    entity.activityCodes.add(String(activity.code))
    if (activity.label) entity.activityLabels.add(String(activity.label))
  }
  activity = null
}

const finishEntity = async () => {
  if (!entity) return
  totals.scanned += 1
  if (entity.status !== 'R') {
    entity = null
    return
  }
  totals.registered += 1
  if (!entity.activityCodes.size) {
    entity = null
    return
  }
  totals.targetActivity += 1

  const websites = [...entity.websites].map(normalizeOutreachWebsite).filter(Boolean)
  const selectedEmail = selectOutreachEmail([...entity.emails], entity.name, websites)
  if (!selectedEmail) {
    entity = null
    return
  }
  totals.withEligibleEmail += 1

  const candidate = {
    registry_code: String(entity.registryCode),
    company_name: entity.name,
    contact_email: selectedEmail.email,
    website_url: websites[0] ?? null,
    activity_codes: [...entity.activityCodes],
    activity_labels: [...entity.activityLabels],
  }
  if (samples.length < 10) samples.push({ ...candidate, email_reason: selectedEmail.reason })
  pendingCandidates.push(candidate)
  entity = null
  if (pendingCandidates.length >= batchSize) await flushBatch()
}

try {
  if (!dryRun) {
    const started = await requestAutomation({
      action: 'start-import',
      source_updated_at: process.env.RIK_SOURCE_UPDATED_AT || null,
    })
    runId = started.run_id
  }

  const unzip = spawn('unzip', ['-p', zipPath], { stdio: ['ignore', 'pipe', 'inherit'] })
  const lines = createInterface({ input: unzip.stdout, crlfDelay: Infinity })

  for await (const line of lines) {
    if (line === '    {') {
      entity = {
        registryCode: null,
        name: null,
        status: null,
        emails: new Set(),
        websites: new Set(),
        activityCodes: new Set(),
        activityLabels: new Set(),
      }
      section = null
      continue
    }
    if (!entity) continue

    if (line.startsWith('        "ariregistri_kood":')) {
      entity.registryCode = parseLineValue(line)
    } else if (line.startsWith('        "nimi":')) {
      entity.name = parseLineValue(line)
    } else if (line.startsWith('            "staatus":')) {
      entity.status ??= parseLineValue(line)
    } else if (line === '            "sidevahendid":[') {
      section = 'contacts'
    } else if (line === '            "teatatud_tegevusalad":[') {
      section = 'activities'
    } else if (line === '            ],' && section) {
      if (section === 'contacts') finishContact()
      if (section === 'activities') finishActivity()
      section = null
    } else if (section === 'contacts') {
      if (line === '                {') {
        finishContact()
        contact = { type: null, value: null, endDate: undefined }
      } else if (line.startsWith('                    "liik":')) {
        contact.type = parseLineValue(line)
      } else if (line.startsWith('                    "sisu":')) {
        contact.value = parseLineValue(line)
      } else if (line.startsWith('                    "lopp_kpv":')) {
        contact.endDate = parseLineValue(line)
      } else if (line === '                },' || line === '                }') {
        finishContact()
      }
    } else if (section === 'activities') {
      if (line === '                {') {
        finishActivity()
        activity = { code: null, label: null, endDate: undefined }
      } else if (line.startsWith('                    "emtak_kood":')) {
        activity.code = parseLineValue(line)
      } else if (line.startsWith('                    "emtak_tekstina":')) {
        activity.label = parseLineValue(line)
      } else if (line.startsWith('                    "lopp_kpv":')) {
        activity.endDate = parseLineValue(line)
      } else if (line === '                },' || line === '                }') {
        finishActivity()
      }
    }

    if (line === '    },' || line === '    }') await finishEntity()
  }

  const exitCode = await new Promise((resolve) => unzip.once('close', resolve))
  if (exitCode !== 0) throw new Error(`Registrifaili lahtipakkimine ebaõnnestus (${exitCode}).`)
  await flushBatch()

  if (!dryRun) {
    await requestAutomation({ action: 'complete-import', run_id: runId, scanned_count: totals.scanned })
  }
  console.log(JSON.stringify({ dryRun, runId, totals, samples }, null, 2))
} catch (error) {
  if (!dryRun && runId) {
    try {
      await requestAutomation({
        action: 'fail-import',
        run_id: runId,
        error_message: error instanceof Error ? error.message : String(error),
      }, 1)
    } catch {
      // Preserve the original import failure.
    }
  }
  throw error
}
