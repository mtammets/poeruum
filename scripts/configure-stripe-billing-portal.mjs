import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const action = process.argv[2] ?? 'verify'
if (!['apply', 'verify'].includes(action)) throw new Error('Kasuta: node scripts/configure-stripe-billing-portal.mjs [apply|verify]')
const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
const appUrl = process.env.APP_URL?.trim()?.replace(/\/$/, '')
if (!stripeKey || !appUrl) throw new Error('Puudub STRIPE_SECRET_KEY või APP_URL.')

const stripeRequest = async (path, options = {}) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${stripeKey}`, ...options.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Stripe ${response.status}: ${body.error?.message ?? JSON.stringify(body)}`)
  return body
}

const configurations = await stripeRequest('billing_portal/configurations?limit=100')
let portal = configurations.data.find((item) => item.metadata?.poeruum_config === 'billing-v1')

if (action === 'apply') {
  const values = {
    name: 'Poeruum',
    default_return_url: `${appUrl}/?billing=manage`,
    'business_profile[headline]': 'Halda Poeruumi Kindla paketi makseviisi ja arveid.',
    'business_profile[privacy_policy_url]': `${appUrl}/privaatsus`,
    'business_profile[terms_of_service_url]': `${appUrl}/kasutustingimused`,
    'features[customer_update][enabled]': 'true',
    'features[customer_update][allowed_updates][]': ['name', 'address', 'phone'],
    'features[invoice_history][enabled]': 'true',
    'features[payment_method_update][enabled]': 'true',
    'features[subscription_cancel][enabled]': 'false',
    'features[subscription_update][enabled]': 'false',
    'metadata[poeruum_config]': 'billing-v1',
  }
  if (portal) values.active = 'true'
  const body = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((item) => body.append(name, item))
    else body.set(name, value)
  }
  portal = await stripeRequest(
    portal ? `billing_portal/configurations/${portal.id}` : 'billing_portal/configurations',
    { method: 'POST', body },
  )
}

const valid = Boolean(
  portal?.active
  && portal.default_return_url === `${appUrl}/?billing=manage`
  && portal.features?.invoice_history?.enabled
  && portal.features?.payment_method_update?.enabled
  && portal.features?.subscription_cancel?.enabled === false
  && portal.features?.subscription_update?.enabled === false
)
if (!valid) throw new Error('Poeruumi Stripe Billing Portali konfiguratsioon puudub või ei vasta nõuetele. Käivita apply.')
console.log(JSON.stringify({
  configured: true,
  mode: portal.livemode ? 'live' : 'test',
  paymentMethodUpdate: true,
  invoiceHistory: true,
  subscriptionChangesControlledByPoeruum: true,
}, null, 2))
