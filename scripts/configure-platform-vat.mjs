import { config } from 'dotenv'
import { PLATFORM_BUSINESS } from '../shared/platform-business.mjs'

config({ quiet: true })
const action = process.argv[2] ?? 'verify'
const mode = process.argv[3] ?? 'test'
if (!['verify', 'apply'].includes(action) || !['test', 'live'].includes(mode)) throw new Error('Usage: node scripts/configure-platform-vat.mjs [verify|apply] [test|live]')
const key = process.env[mode === 'live' ? 'STRIPE_LIVE_SECRET_KEY' : 'STRIPE_TEST_SECRET_KEY']?.trim()
if (!key || !key.includes(`_${mode}_`)) throw new Error('Matching Stripe key is required')
async function stripe(path, values) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: values ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}` },
    body: values ? new URLSearchParams(values) : undefined,
  })
  const result = await response.json()
  if (!response.ok) throw new Error(`Stripe ${response.status}: ${result.error?.message ?? 'Request failed'}`)
  return result
}
let account = await stripe('account')
if (account.country !== PLATFORM_BUSINESS.country || account.company?.name !== PLATFORM_BUSINESS.name) throw new Error('Stripe account is not Animaator OÜ in Estonia')
let taxId = (await stripe('tax_ids?limit=100')).data.find((item) => item.owner?.type === 'self' && item.type === 'eu_vat' && item.value === PLATFORM_BUSINESS.vatNumber)
let defaults = (account.settings?.invoices?.default_account_tax_ids ?? []).map((item) => typeof item === 'string' ? item : item.id)
if (action === 'apply') {
  if (!taxId) taxId = await stripe('tax_ids', { type: 'eu_vat', value: PLATFORM_BUSINESS.vatNumber })
  // Stripe permits Accounts.update only for connected accounts. The platform
  // owner's default invoice tax ID must be selected in its Dashboard.
  account = await stripe('account')
  defaults = (account.settings?.invoices?.default_account_tax_ids ?? []).map((item) => typeof item === 'string' ? item : item.id)
}
const configured = Boolean(taxId && defaults.includes(taxId.id))
console.log(JSON.stringify({ mode, company: account.company.name, vatNumber: PLATFORM_BUSINESS.vatNumber,
  effectiveDate: PLATFORM_BUSINESS.vatRegistrationDate, taxIdExists: Boolean(taxId), defaultForInvoices: configured,
  ...(!configured && taxId ? { actionRequired: 'Set this account tax ID as default in Stripe Dashboard invoice settings.', settingsUrl: 'https://dashboard.stripe.com/settings/billing/invoice' } : {}),
}, null, 2))
if (!configured) process.exitCode = 1
