import { appendFile } from 'node:fs/promises'
import 'dotenv/config'

const action = process.argv[2]
const stripeKey = process.env.STRIPE_TEST_SECRET_KEY?.trim() || process.env.STRIPE_SECRET_KEY?.trim()
if (!stripeKey?.startsWith('sk_test_')) throw new Error('Stripe E2E ressursid nõuavad sk_test_ võtit.')

const stripeRequest = async (path, options = {}) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${stripeKey}`, ...options.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Stripe ${response.status}: ${body.error?.message ?? JSON.stringify(body)}`)
  return body
}

const stripePost = (path, values) => {
  const body = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((item) => body.append(name, String(item)))
    else if (value !== undefined && value !== null) body.set(name, String(value))
  }
  return stripeRequest(path, { method: 'POST', body })
}

const waitForConnectedAccount = async (accountId, attempts = 90) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const account = await stripeRequest(`accounts/${accountId}`)
    if (
      account.charges_enabled
      && account.payouts_enabled
      && account.capabilities?.card_payments === 'active'
      && account.capabilities?.transfers === 'active'
    ) return account
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('Ajutise Stripe Connect konto võimalused ei aktiveerunud kolme minuti jooksul.')
}

const writeEnvironment = async (values) => {
  const environmentFile = process.env.GITHUB_ENV
  for (const [name, value] of Object.entries(values)) {
    if (process.env.GITHUB_ACTIONS === 'true' && name.includes('SECRET')) console.log(`::add-mask::${value}`)
    if (environmentFile) await appendFile(environmentFile, `${name}=${value}\n`)
  }
}

const created = {}

const deactivateResources = async (resources) => {
  if (resources.webhookEndpointId) {
    await stripeRequest(`webhook_endpoints/${resources.webhookEndpointId}`, { method: 'DELETE' }).catch(() => null)
  }
  if (resources.priceId) await stripePost(`prices/${resources.priceId}`, { active: false }).catch(() => null)
  if (resources.productId) await stripePost(`products/${resources.productId}`, { active: false }).catch(() => null)
  if (resources.taxRateId) await stripePost(`tax_rates/${resources.taxRateId}`, { active: false }).catch(() => null)
  if (resources.connectedAccountId) {
    await stripeRequest(`accounts/${resources.connectedAccountId}`, { method: 'DELETE' }).catch(() => null)
  }
}

const createResources = async () => {
  const runId = process.env.GITHUB_RUN_ID?.trim() || Date.now().toString()
  try {
    const connectedAccount = await stripePost('accounts', {
      country: 'US',
      email: `poeruum-e2e-${runId}@example.com`,
      business_type: 'individual',
      'controller[fees][payer]': 'application',
      'controller[losses][payments]': 'application',
      'controller[requirement_collection]': 'application',
      'controller[stripe_dashboard][type]': 'none',
      'business_profile[mcc]': '5734',
      'business_profile[product_description]': 'Poeruumi ajutine e-poe testkonto',
      'capabilities[card_payments][requested]': true,
      'capabilities[transfers][requested]': true,
      'individual[first_name]': 'Poeruum',
      'individual[last_name]': 'E2E',
      'individual[email]': `poeruum-e2e-${runId}@example.com`,
      'individual[phone]': '0000000000',
      'individual[dob][day]': 1,
      'individual[dob][month]': 1,
      'individual[dob][year]': 1902,
      'individual[address][line1]': 'address_full_match_sync',
      'individual[address][city]': 'San Francisco',
      'individual[address][state]': 'CA',
      'individual[address][postal_code]': '94107',
      'individual[address][country]': 'US',
      'individual[id_number]': '222222222',
      'individual[verification][document][front]': 'file_identity_document_success',
      'tos_acceptance[date]': Math.floor(Date.now() / 1000),
      'tos_acceptance[ip]': '8.8.8.8',
      external_account: 'btok_us_verified',
      'metadata[poeruum_e2e_run_id]': runId,
    })
    created.connectedAccountId = connectedAccount.id
    await waitForConnectedAccount(connectedAccount.id)
    const product = await stripePost('products', { name: `Poeruum E2E kuupakett ${runId}` })
    created.productId = product.id
    const price = await stripePost('prices', {
      product: product.id,
      currency: 'eur',
      unit_amount: 2900,
      'recurring[interval]': 'month',
    })
    created.priceId = price.id
    const taxRate = await stripePost('tax_rates', {
      display_name: 'KM',
      description: `Poeruum E2E 24% ${runId}`,
      jurisdiction: 'EE',
      country: 'EE',
      percentage: 24,
      inclusive: false,
    })
    created.taxRateId = taxRate.id
    const webhook = await stripePost('webhook_endpoints', {
      url: `${process.env.VITE_SUPABASE_URL}/functions/v1/stripe-webhook`,
      description: `Poeruum ephemeral E2E ${runId}`,
      'enabled_events[]': [
        'checkout.session.completed',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'invoice.paid',
        'invoice.payment_failed',
      ],
    })
    created.webhookEndpointId = webhook.id

    await writeEnvironment({
      STRIPE_FIXED_PLAN_PRICE_ID: price.id,
      STRIPE_FIXED_PLAN_TAX_RATE_ID: taxRate.id,
      STRIPE_WEBHOOK_SECRET: webhook.secret,
      E2E_STRIPE_PRODUCT_ID: product.id,
      E2E_STRIPE_PRICE_ID: price.id,
      E2E_STRIPE_TAX_RATE_ID: taxRate.id,
      E2E_STRIPE_WEBHOOK_ENDPOINT_ID: webhook.id,
      E2E_STRIPE_CONNECTED_ACCOUNT_ID: connectedAccount.id,
    })
    console.log(JSON.stringify({
      created: true,
      productId: product.id,
      priceId: price.id,
      taxRateId: taxRate.id,
      webhookEndpointId: webhook.id,
      connectedAccountId: connectedAccount.id,
    }))
  } catch (error) {
    await deactivateResources(created)
    throw error
  }
}

const deleteResources = async () => {
  await deactivateResources({
    productId: process.env.E2E_STRIPE_PRODUCT_ID,
    priceId: process.env.E2E_STRIPE_PRICE_ID,
    taxRateId: process.env.E2E_STRIPE_TAX_RATE_ID,
    webhookEndpointId: process.env.E2E_STRIPE_WEBHOOK_ENDPOINT_ID,
    connectedAccountId: process.env.E2E_STRIPE_CONNECTED_ACCOUNT_ID,
  })
  console.log(JSON.stringify({ cleaned: true }))
}

if (action === 'create') await createResources()
else if (action === 'delete') await deleteResources()
else throw new Error('Kasutus: node scripts/manage-stripe-e2e-resources.mjs create|delete')
