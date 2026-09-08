import { randomUUID } from 'node:crypto'

export const screens = ['store', 'business', 'payments', 'shipping', 'product', 'publish']
export const paymentStates = ['idle', 'incomplete', 'reviewing', 'connected', 'requirements']
export const stripePresets = ['new', 'business', 'person', 'address']
const emptyRequirements = { dueCount: 0, pastDue: false, currentDeadline: null, pendingVerification: false, disabledReason: null, issues: [] }

export function testConfiguration(environment) {
  const publishableKey = environment.STRIPE_TEST_PUBLISHABLE_KEY?.trim() || ''
  const secretKey = environment.STRIPE_TEST_SECRET_KEY?.trim() || ''
  const ready = publishableKey.startsWith('pk_test_') && secretKey.startsWith('sk_test_')
  return { ready, publishableKey: ready ? publishableKey : '', secretKey: ready ? secretKey : '' }
}

export function createPreviewService({ origin, environment, helpers, fetchStripe = fetch }) {
  const configuration = testConfiguration(environment)
  const sessions = new Map()
  const accounts = new Set()
  const runId = randomUUID()
  let stopping = false
  let cleanupPromise

  const stripe = async (path, values, method = values ? 'POST' : 'GET', idempotencyKey) => {
    if (!configuration.ready) throw new Error('Lisa Stripe’i testvõtmed .env.local faili ja käivita eelvaade uuesti.')
    const body = new URLSearchParams()
    const append = (prefix, value) => {
      if (value === undefined || value === null) return
      if (typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) append(`${prefix}[${key}]`, item)
      } else body.set(prefix, String(value))
    }
    for (const [key, value] of Object.entries(values ?? {})) append(key, value)
    const response = await fetchStripe(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${configuration.secretKey}`,
        ...(values ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(values ? { body } : {}),
      signal: AbortSignal.timeout(20000),
    })
    const data = await response.json()
    if (!response.ok) {
      // Do not surface provider payloads, which can contain entered data or credentials.
      const field = typeof data.error?.param === 'string' && /^[a-z_[\].]{1,100}$/.test(data.error.param) ? ` Väli: ${data.error.param}.` : ''
      throw new Error(`Stripe’i testpäring ebaõnnestus (HTTP ${response.status}).${field} Kontrolli sama testkeskkonna võtmeid ja Connecti seadistust.`)
    }
    return data
  }

  function createSession(input = {}) {
    if (stopping) throw new Error('Eelvaade sulgub.')
    if (sessions.size >= 100) throw new Error('Eelvaate katsete piir on täis. Käivita eelvaade uuesti.')
    const kind = input.kind ?? 'app'
    const screen = input.screen ?? 'payments'
    const paymentState = input.paymentState ?? 'idle'
    const preset = input.preset ?? 'new'
    if (!['app', 'stripe'].includes(kind) || !screens.includes(screen) || !paymentStates.includes(paymentState) || !stripePresets.includes(preset)) {
      throw new Error('Tundmatu eelvaate olukord.')
    }
    if (kind === 'stripe' && !configuration.ready) throw new Error('Stripe’i testvõtmed on lisamata.')
    const id = randomUUID()
    const userId = randomUUID()
    const now = new Date().toISOString()
    const requirements = { ...emptyRequirements, issues: [] }
    if (paymentState === 'incomplete') requirements.dueCount = 3
    if (paymentState === 'reviewing') Object.assign(requirements, { pendingVerification: true, disabledReason: 'requirements.pending_verification' })
    if (paymentState === 'requirements') Object.assign(requirements, {
      dueCount: 1, currentDeadline: new Date(Date.now() + 7 * 86400000).toISOString(),
      issues: [{ code: 'verification_document_address_mismatch', requirement: 'company.verification.document' }],
    })
    const status = ['connected', 'requirements'].includes(paymentState) ? 'connected' : paymentState === 'idle' ? 'idle' : 'pending'
    const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'eelvaade@example.com', email_confirmed_at: now,
      app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now, updated_at: now }
    const store = {
      id: randomUUID(), owner_id: userId, name: 'Näidise käsitööpood', slug: 'naidise-kasitood', is_published: false,
      payment_provider: 'stripe', payment_status: status, stripe_account_id: status === 'idle' ? null : 'acct_preview_simulated',
      stripe_account_charges_enabled: status === 'connected', stripe_account_payouts_enabled: status === 'connected',
      ...helpers.stripeRequirementStoreUpdate(requirements),
      stripe_customer_id: null, stripe_subscription_id: null, stripe_subscription_status: null,
      pricing_plan: 'flexible', trial_started_at: null, billing_delinquent_at: null, billing_grace_ends_at: null,
      billing_last_failed_invoice_id: null, billing_last_failed_invoice_url: null, billing_downgraded_at: null,
      shipping: ['omniva'], settings: {
        onboardingStep: screen, businessName: 'Näidise Käsitöö OÜ', registryCode: '12345678',
        businessAddress: 'Näidise 7, Tallinn, 10111', contactEmail: 'eelvaade@example.com',
      },
    }
    const products = ['publish'].includes(screen) ? [{
      id: randomUUID(), store_id: store.id, name: 'Käsitööna valminud kruus', slug: 'kasitoo-kruus',
      image_url: `${origin}/storage/v1/object/public/product-images/preview.svg`,
      description: 'Näidistoode maksete ja poe avaldamise eelvaateks.', price: 18, stock: 5,
      sort_order: 0, search_visible: true,
    }] : []
    const session = { id, kind, preset, user, store, products, requirements, detailsSubmitted: !['idle', 'incomplete'].includes(paymentState), accountId: null, accountPromise: null, messages: [], conversations: [] }
    sessions.set(id, session)
    return session
  }

  const getSession = (id) => {
    const session = sessions.get(id)
    if (!session) throw new Error('Eelvaate katse aegus. Ava olukord uuesti eelvaate menüüst.')
    return session
  }

  const authSession = (session) => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const token = [encode({ alg: 'HS256', typ: 'JWT' }), encode({ sub: session.user.id, preview: session.id, exp: Math.floor(Date.now() / 1000) + 86400, aud: 'authenticated', role: 'authenticated' }), 'local-preview'].join('.')
    return { access_token: token, refresh_token: session.id, token_type: 'bearer', expires_in: 86400,
      expires_at: Math.floor(Date.now() / 1000) + 86400, user: session.user }
  }

  const fromAuthorization = (authorization) => {
    // These tokens identify local fixtures, and are never sent to Supabase or Stripe.
    const token = authorization?.replace(/^Bearer /, '')
    if (token?.split('.')[2] === 'local-preview') {
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
        const session = sessions.get(payload.preview)
        if (session && payload.sub === session.user.id && payload.exp > Date.now() / 1000) return session
      } catch { /* invalid local token */ }
    }
    throw new Error('Eelvaate sessioon puudub.')
  }

  async function ensureAccount(session) {
    if (stopping) throw new Error('Eelvaade sulgub.')
    if (session.accountId) return session.accountId
    if (session.accountPromise) return session.accountPromise
    if (accounts.size >= 40) throw new Error('Stripe’i testkontode piir on täis. Sule ja käivita eelvaade uuesti, et ajutised kontod koristada.')
    session.accountPromise = (async () => {
      const prefill = helpers.getStripePrefill(session.store, session.user.email)
      const businessFilled = session.preset !== 'new'
      const account = await stripe('accounts', {
        country: 'EE', ...prefill,
        ...(businessFilled ? {
          company: { ...prefill.company, structure: 'private_corporation', phone: '0000000000',
            address: { country: 'EE', line1: session.preset === 'address' ? 'address_line1_no_match' : 'address_full_match', city: 'Tallinn', postal_code: '10111' } },
          business_profile: { ...prefill.business_profile, mcc: '5734' },
        } : {}),
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        controller: { fees: { payer: 'application' }, losses: { payments: 'application' }, requirement_collection: 'application', stripe_dashboard: { type: 'none' } },
        metadata: { poeruum_payment_preview: runId, preview_session: session.id },
      }, 'POST', `payment-preview-${runId}-${session.id}`)
      accounts.add(account.id)
      if (session.preset === 'person') {
        await stripe(`accounts/${account.id}/persons`, {
          first_name: 'Näidis', last_name: 'Kaupmees', email: 'eelvaade@example.com', phone: '0000000000',
          dob: { day: 1, month: 1, year: 1901 },
          address: { country: 'EE', line1: 'address_full_match', city: 'Tallinn', postal_code: '10111' },
          relationship: { representative: true, owner: true, director: true, executive: true, percent_ownership: 100, title: 'Juhatuse liige' },
        }, 'POST', `payment-preview-person-${runId}-${session.id}`)
        await stripe(`accounts/${account.id}`, { company: { owners_provided: true, directors_provided: true, executives_provided: true } })
      }
      session.accountId = account.id
      session.store.stripe_account_id = account.id
      return account.id
    })()
    try { return await session.accountPromise } finally { session.accountPromise = null }
  }

  async function stripeAction(session, action, mode = 'onboarding') {
    if (!['status', 'start'].includes(action) || !['onboarding', 'remediation', 'management'].includes(mode)) throw new Error('Tundmatu Stripe’i toiming.')
    if (action === 'status' && !session.accountId && session.kind === 'app') {
      return { status: session.store.payment_status, chargesEnabled: session.store.stripe_account_charges_enabled,
        payoutsEnabled: session.store.stripe_account_payouts_enabled, detailsSubmitted: session.detailsSubmitted, requirements: session.requirements }
    }
    const accountId = await ensureAccount(session)
    if (action === 'start') {
      const account = await stripe(`accounts/${accountId}`)
      const resolvedMode = helpers.resolveStripeConnectSessionMode(true, mode, account.details_submitted === true)
      const result = await stripe('account_sessions', { account: accountId, components: helpers.getStripeConnectSessionComponents(resolvedMode) })
      return { clientSecret: result.client_secret }
    }
    const account = await stripe(`accounts/${accountId}`)
    const requirements = helpers.summarizeStripeRequirements(account)
    const status = account.charges_enabled && account.payouts_enabled ? 'connected' : 'pending'
    Object.assign(session.store, { payment_status: status, stripe_account_id: account.id,
      stripe_account_charges_enabled: account.charges_enabled, stripe_account_payouts_enabled: account.payouts_enabled,
      ...helpers.stripeRequirementStoreUpdate(requirements) })
    session.requirements = requirements
    session.detailsSubmitted = account.details_submitted
    return { status, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled, detailsSubmitted: account.details_submitted, requirements }
  }

  function cleanup() {
    if (cleanupPromise) return cleanupPromise
    stopping = true
    cleanupPromise = (async () => {
      await Promise.allSettled([...sessions.values()].map((session) => session.accountPromise).filter(Boolean))
      const results = await Promise.allSettled([...accounts].map(async (id) => {
        // Only account IDs created by this process can enter the deletion set.
        await stripe(`accounts/${id}`, undefined, 'DELETE')
        accounts.delete(id)
      }))
      return { failed: results.filter((result) => result.status === 'rejected').length, remaining: [...accounts] }
    })()
    return cleanupPromise
  }

  return { configuration: { ready: configuration.ready, publishableKey: configuration.publishableKey }, createSession, getSession, authSession, fromAuthorization, stripeAction, cleanup }
}
