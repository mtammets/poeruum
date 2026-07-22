import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const apiKey = required('RESEND_API_KEY')
const projectRef = required('SUPABASE_PROJECT_REF')
const endpoint = `https://${projectRef}.supabase.co/functions/v1/resend-webhook`
const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'poeruum-support-setup/1.0' }

const request = async (pathName, options = {}) => {
  const response = await fetch(`https://api.resend.com${pathName}`, { ...options, headers: { ...headers, ...options.headers } })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || `Resend ${pathName} vastas ${response.status}.`)
  return result
}

const webhookList = await request('/webhooks')
const existingWebhook = webhookList.data?.find((item) => item.endpoint === endpoint)
const webhook = existingWebhook
  ? await request(`/webhooks/${existingWebhook.id}`)
  : await request('/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        endpoint,
        events: ['email.sent', 'email.delivered', 'email.failed', 'email.bounced', 'email.complained', 'email.received'],
      }),
    })

if (!webhook.signing_secret) throw new Error('Resendi webhooki allkirjastamise võtit ei tagastatud.')

const supabaseCli = path.resolve('node_modules', '.bin', process.platform === 'win32' ? 'supabase.cmd' : 'supabase')
const secretsResult = spawnSync(supabaseCli, [
  'secrets', 'set',
  `RESEND_WEBHOOK_SECRET=${webhook.signing_secret}`,
  'SUPPORT_NOTIFICATION_EMAIL=mtammets@gmail.com',
  'SUPPORT_REPLY_TO=mtammets@gmail.com',
  '--project-ref', projectRef,
], { env: process.env, stdio: 'inherit' })
if (secretsResult.status !== 0) process.exit(secretsResult.status ?? 1)

const domainList = await request('/domains')
let supportDomain = domainList.data?.find((item) => item.name === 'tugi.poeruum.ee')
if (!supportDomain) {
  supportDomain = await request('/domains', {
    method: 'POST',
    body: JSON.stringify({
      name: 'tugi.poeruum.ee',
      region: 'eu-west-1',
      capabilities: { sending: 'disabled', receiving: 'enabled' },
    }),
  })
} else {
  supportDomain = await request(`/domains/${supportDomain.id}`)
}

console.log(`Resendi webhook ${existingWebhook ? 'oli juba olemas' : 'loodi'}: ${webhook.id}`)
console.log(`Tugikirjade vastuvõtudomeen: ${supportDomain.name} (${supportDomain.status})`)
for (const record of supportDomain.records ?? []) {
  console.log(`${record.type} | ${record.name} | ${record.value}${record.priority != null ? ` | prioriteet ${record.priority}` : ''}`)
}
