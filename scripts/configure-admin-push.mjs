import { config } from 'dotenv'
import { createECDH, createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
config({ path: '.env', quiet: true })
const action = process.argv[2] ?? 'verify'
if (!['prepare', 'apply', 'verify'].includes(action)) throw new Error('Usage: node scripts/configure-admin-push.mjs [prepare|apply|verify]')
const names = ['ADMIN_PUSH_VAPID_PUBLIC_KEY', 'ADMIN_PUSH_VAPID_PRIVATE_KEY']
const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_ACCESS_TOKEN
if (!ref || !token) throw new Error('Supabase management configuration is missing')
const base = `https://api.supabase.com/v1/projects/${ref}`
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  if (!response.ok) throw new Error(`Supabase ${path}: HTTP ${response.status}`)
  const content = await response.text()
  return content ? JSON.parse(content) : null
}
const secrets = await request('/secrets')
const present = names.filter((name) => secrets.some((secret) => secret.name === name))
if (present.length === 1) throw new Error('Only one VAPID key is configured remotely; resolve this before continuing')
if (action !== 'verify') {
  if (!names.every((name) => process.env[name]?.trim())) {
    if (present.length || names.some((name) => process.env[name]?.trim())) throw new Error('Existing keys must be recovered; refusing to rotate device subscriptions')
    const key = createECDH('prime256v1'); key.generateKeys()
    const values = [key.getPublicKey().toString('base64url'), key.getPrivateKey().toString('base64url')]
    let env = await readFile('.env', 'utf8')
    for (const [i, name] of names.entries()) {
      env = env.replace(new RegExp(`^${name}=.*(?:\\r?\\n|$)`, 'gm'), '')
      process.env[name] = values[i]
    }
    await writeFile('.env', `${env.trimEnd()}\n\n# Admin Web Push: retain these keys to preserve existing subscriptions.\n${names.map((name) => `${name}=${process.env[name]}`).join('\n')}\n`, { mode: 0o600 })
    console.log('VAPID keys saved to the ignored local .env file; no key values printed.')
  }
  for (const name of present) {
    const digest = createHash('sha256').update(process.env[name].trim()).digest('hex')
    if (secrets.find((secret) => secret.name === name)?.value !== digest) throw new Error('Remote VAPID keys differ; refusing to rotate existing subscriptions')
  }
  if (action === 'prepare') { console.log('Local push configuration is ready. Remote state unchanged.'); process.exit(0) }
  await request('/secrets', 'POST', names.map((name) => ({ name, value: process.env[name].trim() })))
  console.log('VAPID keys configured in Supabase Edge Functions.')
}
const currentSecrets = action === 'verify' ? secrets : await request('/secrets')
if (!names.every((name) => currentSecrets.some((secret) => secret.name === name))) throw new Error('Push keys are not configured remotely')
// The read_only API role cannot evaluate Vault's decryption function. This SELECT
// returns only booleans; no secret values leave the database.
const [state] = await request('/database/query', 'POST', { read_only: false, query: `select
  to_regclass('public.admin_push_subscriptions') is not null as subscriptions,
  exists(select 1 from cron.job where jobname='poeruum-admin-push' and active) as scheduled,
  exists(select 1 from vault.decrypted_secrets where name='onboarding_reminders_url' and decrypted_secret ~ '^https://[a-z0-9]+\\.supabase\\.co/functions/v1/onboarding-reminders$') as dispatch_url,
  exists(select 1 from vault.decrypted_secrets where name='onboarding_cron_secret' and length(decrypted_secret)>0) as cron_secret` })
if (!Object.values(state).every(Boolean) || !currentSecrets.some((secret) => secret.name === 'ONBOARDING_CRON_SECRET')) throw new Error(`Push infrastructure is incomplete: ${JSON.stringify(state)}`)
console.log('Push keys, private schema, cron and dispatch configuration verified. Complete a device test after publishing the frontend.')
