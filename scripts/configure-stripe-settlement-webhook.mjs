import { config } from 'dotenv'

config({ path: '.env', quiet: true })
const command = process.argv[2] ?? 'check'
if (!['check', 'apply'].includes(command)) throw new Error('Kasuta: node scripts/configure-stripe-settlement-webhook.mjs check|apply')
const key = process.env.STRIPE_SECRET_KEY?.trim()
const mode = /^(sk|rk)_(test|live)_/.exec(key ?? '')?.[2]
if (!mode || (process.env.STRIPE_MODE && process.env.STRIPE_MODE !== mode)) throw new Error('Stripe’i võtme režiim ei vasta seadistusele.')
const baseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
if (!baseUrl) throw new Error('Supabase’i aadress puudub.')
const expectedUrl = new URL('/functions/v1/stripe-webhook', baseUrl).href
const requiredEvents = ['charge.updated', 'refund.updated', 'refund.failed']
const request = async (path, body) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}` }, body,
  })
  const result = await response.json()
  if (!response.ok) throw new Error(`Stripe’i endpoint'i seadistamine ebaõnnestus (${response.status}).`)
  return result
}
const endpoints = []
let cursor = ''
do {
  const page = await request(`webhook_endpoints?limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`)
  endpoints.push(...page.data)
  cursor = page.has_more ? page.data.at(-1).id : ''
} while (cursor)
const matches = endpoints.filter((endpoint) => endpoint.url === expectedUrl && endpoint.status === 'enabled'
  && (!process.env.STRIPE_WEBHOOK_ENDPOINT_ID || endpoint.id === process.env.STRIPE_WEBHOOK_ENDPOINT_ID))
if (matches.length !== 1) throw new Error('Ühte aktiivset stripe-webhook endpoint’i ei leitud. Mitme vaste korral määra STRIPE_WEBHOOK_ENDPOINT_ID.')
const endpoint = matches[0]
if (endpoint.livemode !== (mode === 'live')) throw new Error('Endpoint on vales Stripe’i režiimis.')
const missing = endpoint.enabled_events.includes('*') ? [] : requiredEvents.filter((event) => !endpoint.enabled_events.includes(event))
if (command === 'apply' && missing.length) {
  // Preserve all billing and other subscriptions already configured here.
  const body = new URLSearchParams()
  for (const event of [...endpoint.enabled_events, ...missing]) body.append('enabled_events[]', event)
  const updated = await request(`webhook_endpoints/${endpoint.id}`, body)
  if (!requiredEvents.every((event) => updated.enabled_events.includes(event))) throw new Error('Endpoint ei salvestanud kõiki nõutud sündmusi.')
}
console.log(JSON.stringify({ mode, endpointId: endpoint.id, command, missingEvents: missing,
  changed: command === 'apply' && missing.length > 0 }, null, 2))
