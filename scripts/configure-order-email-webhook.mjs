import { config } from 'dotenv'

config({ path: '.env', quiet: true })
const command = process.argv[2] ?? 'check'
if (!['check','apply'].includes(command)) throw new Error('Kasuta: node scripts/configure-order-email-webhook.mjs check|apply')
const apiKey = process.env.RESEND_API_KEY?.trim()
const baseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
if (!apiKey || !baseUrl) throw new Error('Puudub Resendi võti või Supabase’i aadress.')
const expectedUrl = new URL('/functions/v1/resend-webhook', baseUrl).href
const requiredEvents = ['email.sent','email.delivered','email.delivery_delayed','email.failed','email.bounced','email.complained','email.suppressed']
const request = async (path, body) => {
  const response = await fetch(`https://api.resend.com${path}`, {
    method: body ? 'PATCH' : 'GET', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(`Resendi webhooki kontroll ebaõnnestus (${response.status}).`)
  return result
}
const endpoints = []
let cursor = ''
do {
  const page = await request(`/webhooks?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`)
  endpoints.push(...page.data)
  cursor = page.has_more ? page.data.at(-1)?.id : ''
} while (cursor)
const matches = endpoints.filter((endpoint) => endpoint.endpoint === expectedUrl
  && (!process.env.RESEND_WEBHOOK_ID || endpoint.id === process.env.RESEND_WEBHOOK_ID))
if (matches.length !== 1) throw new Error('Ühte õige aadressiga Resendi webhooki ei leitud. Mitme vaste korral määra RESEND_WEBHOOK_ID.')
const endpoint = await request(`/webhooks/${matches[0].id}`)
const missingEvents = requiredEvents.filter((event) => !endpoint.events.includes(event))
if (command === 'apply' && (missingEvents.length || endpoint.status !== 'enabled')) {
  await request(`/webhooks/${endpoint.id}`, { events: [...endpoint.events, ...missingEvents], status: 'enabled' })
  const updated = await request(`/webhooks/${endpoint.id}`)
  if (updated.status !== 'enabled' || !requiredEvents.every((event) => updated.events.includes(event))) throw new Error('Resendi webhooki seadistus ei salvestunud.')
}
// Never print the signing_secret returned by the provider.
console.log(JSON.stringify({ command, webhookId: endpoint.id, status: endpoint.status, missingEvents,
  changed: command === 'apply' && (missingEvents.length > 0 || endpoint.status !== 'enabled') }, null, 2))
