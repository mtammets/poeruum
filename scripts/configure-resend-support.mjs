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
const publicSupportEmail = process.env.SUPPORT_PUBLIC_EMAIL?.trim().toLowerCase() || 'info@poeruum.ee'
const inboundDomain = process.env.SUPPORT_INBOUND_DOMAIN?.trim().toLowerCase().replace(/^@/, '') || 'poeruum.ee'
const inboundAddress = process.env.SUPPORT_INBOUND_ADDRESS?.trim().toLowerCase() || `info@${inboundDomain}`
const webhookEvents = ['email.sent', 'email.delivered', 'email.failed', 'email.bounced', 'email.complained', 'email.received']

const request = async (pathName, options = {}) => {
  const response = await fetch(`https://api.resend.com${pathName}`, { ...options, headers: { ...headers, ...options.headers } })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || `Resend ${pathName} vastas ${response.status}.`)
  return result
}

const webhookList = await request('/webhooks')
const existingWebhook = webhookList.data?.find((item) => item.endpoint === endpoint)
let webhook
if (existingWebhook) {
  webhook = await request(`/webhooks/${existingWebhook.id}`)
  const hasExpectedEvents = webhookEvents.every((event) => webhook.events?.includes(event))
  if (!hasExpectedEvents || webhook.status !== 'enabled') {
    await request(`/webhooks/${webhook.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ endpoint, events: webhookEvents, status: 'enabled' }),
    })
    webhook = await request(`/webhooks/${webhook.id}`)
  }
} else {
  webhook = await request('/webhooks', {
      method: 'POST',
      body: JSON.stringify({ endpoint, events: webhookEvents }),
    })
}

if (!webhook.signing_secret) throw new Error('Resendi webhooki allkirjastamise võtit ei tagastatud.')

const domainList = await request('/domains')
let supportDomain = domainList.data?.find((item) => item.name === inboundDomain)
if (!supportDomain) {
  supportDomain = await request('/domains', {
    method: 'POST',
    body: JSON.stringify({
      name: inboundDomain,
      region: 'eu-west-1',
      capabilities: { sending: 'disabled', receiving: 'enabled' },
    }),
  })
} else {
  supportDomain = await request(`/domains/${supportDomain.id}`)
  if (supportDomain.capabilities?.receiving !== 'enabled') {
    await request(`/domains/${supportDomain.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ capabilities: { receiving: 'enabled' } }),
    })
    supportDomain = await request(`/domains/${supportDomain.id}`)
  }
}

if (supportDomain.status !== 'verified') {
  await request(`/domains/${supportDomain.id}/verify`, { method: 'POST' })
}
const receivingRecord = supportDomain.records?.find((record) => record.record === 'Receiving')
if (receivingRecord?.status !== 'verified') {
  await request(`/domains/${supportDomain.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ capabilities: { receiving: 'enabled' } }),
  })
}
supportDomain = await request(`/domains/${supportDomain.id}`)

const supabaseCli = path.resolve('node_modules', '.bin', process.platform === 'win32' ? 'supabase.cmd' : 'supabase')
const secretArguments = [
  'secrets', 'set',
  `RESEND_WEBHOOK_SECRET=${webhook.signing_secret}`,
  `SUPPORT_PUBLIC_EMAIL=${publicSupportEmail}`,
  `SUPPORT_REPLY_TO=${publicSupportEmail}`,
]
if (supportDomain.status === 'verified') {
  secretArguments.push(
    `SUPPORT_INBOUND_ADDRESS=${inboundAddress}`,
    `SUPPORT_INBOUND_DOMAIN=${inboundDomain}`,
  )
}
const notificationEmail = process.env.SUPPORT_NOTIFICATION_EMAIL?.trim()
if (notificationEmail) secretArguments.push(`SUPPORT_NOTIFICATION_EMAIL=${notificationEmail}`)
secretArguments.push('--project-ref', projectRef)
const secretsResult = spawnSync(supabaseCli, secretArguments, { env: process.env, stdio: 'inherit' })
if (secretsResult.status !== 0) process.exit(secretsResult.status ?? 1)

console.log(`Resendi webhook ${existingWebhook ? 'oli juba olemas' : 'loodi'}: ${webhook.id}`)
console.log(`Tugikirjade vastuvõtudomeen: ${supportDomain.name} (${supportDomain.status})`)
for (const record of supportDomain.records ?? []) {
  console.log(`${record.type} | ${record.name} | ${record.value}${record.priority != null ? ` | prioriteet ${record.priority}` : ''}`)
}
if (supportDomain.status !== 'verified') {
  console.log(`Lisa ülal näidatud täpsed MX- ja TXT-kirjed ning käivita sama käsk uuesti. Avalik tugiaadress on ${publicSupportEmail}.`)
  console.log('SUPPORT_INBOUND_DOMAIN aktiveeritakse alles pärast Resendi kinnitust.')
}
