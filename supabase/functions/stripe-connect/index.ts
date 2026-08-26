import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'
import { assertStoredStripeMode, assertStripeMode } from '../_shared/stripe-mode.ts'
import {
  emptyStripeRequirementStoreUpdate,
  stripeRequirementStoreUpdate,
  summarizeStripeRequirements,
} from '../_shared/stripe-connect-requirements.ts'
import {
  canCreateStripeConnectAccount,
  getStripeConnectSessionComponents,
  parseStripeConnectSessionMode,
  resolveStripeConnectSessionMode,
} from '../_shared/stripe-connect-session.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const getRequiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const stripeAccountStatus = (account: Stripe.Account) => account.charges_enabled && account.payouts_enabled ? 'connected' : 'pending'

const isPoeruumManagedAccount = (account: Stripe.Account) =>
  account.controller?.requirement_collection === 'application'
  && account.controller?.stripe_dashboard?.type === 'none'

const remediationUnavailable = () => json({
  error: 'Ettevõtte andmete kinnitamise vormi ei saa avada, sest Poeruumiga ühendatud Stripe’i kontot ei leitud. Palun võta ühendust Poeruumi toega.',
}, 409)

const storedAccountUnavailable = () => json({
  error: 'Stripe’i kontot ei saa turvaliselt avada. Poeruum ei muutnud konto ühendust. Palun võta ühendust Poeruumi toega.',
}, 409)

type PoeruumStore = {
  id: string
  name: string
  settings?: Record<string, unknown> | null
}

const getStripePrefill = (store: PoeruumStore, fallbackEmail = '') => {
  const settings = store.settings && typeof store.settings === 'object' ? store.settings : {}
  const legalName = String(settings.businessName ?? store.name).trim()
  const registrationNumber = String(settings.registryCode ?? '').trim()
  const address = String(settings.businessAddress ?? '').trim()
  const contactEmail = String(settings.contactEmail ?? fallbackEmail).trim()

  return {
    email: contactEmail || undefined,
    business_type: 'company' as const,
    business_profile: {
      name: legalName,
      product_description: `E-pood ${store.name} Poeruumi platvormil`,
      support_email: contactEmail || undefined,
    },
    company: {
      name: legalName,
      registration_number: registrationNumber || undefined,
      address: address ? { country: 'EE', line1: address } : { country: 'EE' },
    },
  }
}

const createPoeruumManagedAccount = async (
  stripe: Stripe,
  store: PoeruumStore,
  user: { id: string; email?: string },
) => {
  const settings = store.settings && typeof store.settings === 'object' ? store.settings : {}

  return await stripe.accounts.create({
    country: 'EE',
    ...getStripePrefill(store, user.email ?? ''),
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    controller: {
      fees: { payer: 'application' },
      losses: { payments: 'application' },
      requirement_collection: 'application',
      stripe_dashboard: { type: 'none' },
    },
    metadata: {
      poeruum_store_id: store.id,
      poeruum_owner_id: user.id,
      registry_code: String(settings.registryCode ?? ''),
    },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sisselogimine on nõutud.' }, 401)

    const supabaseUrl = getRequiredEnv('SUPABASE_URL')
    const publicKey = getRequiredEnv('POERUUM_SUPABASE_PUBLISHABLE_KEY')
    const serviceRoleKey = getRequiredEnv('POERUUM_SUPABASE_SECRET_KEY')
    const stripeSecretKey = getRequiredEnv('STRIPE_SECRET_KEY')
    const stripeMode = assertStripeMode(stripeSecretKey)
    const stripe = new Stripe(stripeSecretKey)

    const userClient = createClient(supabaseUrl, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)
    const rateLimit = await checkRateLimit(request, 'stripe-connect', 10, 600, user.id)
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retry_after_seconds, corsHeaders)

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: store, error: storeError } = await admin.from('stores').select('*').eq('owner_id', user.id).order('created_at').limit(1).maybeSingle()
    if (storeError) throw storeError
    if (!store) return json({ error: 'Pood tuleb enne Stripe’i ühendamist salvestada.' }, 404)

    const body = await request.json().catch(() => ({})) as {
      action?: string
      mode?: 'onboarding' | 'management' | 'remediation'
    }
    const requestedMode = parseStripeConnectSessionMode(body.mode)
    let accountId = typeof store.stripe_account_id === 'string' ? store.stripe_account_id : null
    const hasStoredAccountId = Boolean(accountId)
    let hasExistingManagedAccount = false
    if (accountId) assertStoredStripeMode(store.stripe_account_mode, stripeMode, 'Poe Stripe’i konto')

    if (body.action === 'status') {
      if (!accountId) {
        const { error } = await admin.from('stores').update(emptyStripeRequirementStoreUpdate()).eq('id', store.id)
        if (error) throw error
        return json({ status: 'idle' })
      }
      const account = await stripe.accounts.retrieve(accountId)
      if ('deleted' in account && account.deleted) {
        await admin.from('stores').update({
          payment_status: 'idle', stripe_account_id: null,
          stripe_account_charges_enabled: false, stripe_account_payouts_enabled: false, stripe_account_mode: null,
          ...emptyStripeRequirementStoreUpdate(),
        }).eq('id', store.id)
        return json({ status: 'idle' })
      }
      const status = stripeAccountStatus(account)
      const requirements = summarizeStripeRequirements(account)
      const { error } = await admin.from('stores').update({
        payment_provider: 'stripe', payment_status: status, stripe_account_mode: stripeMode,
        stripe_account_charges_enabled: account.charges_enabled,
        stripe_account_payouts_enabled: account.payouts_enabled,
        ...stripeRequirementStoreUpdate(requirements),
      }).eq('id', store.id)
      if (error) throw error
      return json({ status, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled, requirements })
    }

    if (body.action !== 'start') return json({ error: 'Tundmatu tegevus.' }, 400)

    // A compliance link may only continue an existing Poeruum-managed account.
    // Never create or replace a payout account from an emailed remediation link.
    if (!accountId && !canCreateStripeConnectAccount(hasStoredAccountId, requestedMode)) {
      return requestedMode === 'remediation' ? remediationUnavailable() : storedAccountUnavailable()
    }

    if (accountId) {
      let retrievedAccount: Stripe.Account | Stripe.DeletedAccount
      try {
        retrievedAccount = await stripe.accounts.retrieve(accountId)
      } catch (error) {
        if ((error as { code?: unknown })?.code === 'resource_missing') return storedAccountUnavailable()
        throw error
      }
      const existingAccountDeleted = 'deleted' in retrievedAccount && retrievedAccount.deleted
      if (existingAccountDeleted || !isPoeruumManagedAccount(retrievedAccount)) {
        // Account replacement is a separate recovery decision. Never orphan a
        // stored payout account merely because a form was opened.
        return requestedMode === 'remediation' ? remediationUnavailable() : storedAccountUnavailable()
      }
      hasExistingManagedAccount = true
    }

    if (!accountId) {
      const account = await createPoeruumManagedAccount(stripe, store, user)
      accountId = account.id
      const requirements = summarizeStripeRequirements(account)
      const { error } = await admin.from('stores').update({
        payment_provider: 'stripe', payment_status: 'pending', stripe_account_id: account.id, stripe_account_mode: stripeMode,
        stripe_account_charges_enabled: account.charges_enabled,
        stripe_account_payouts_enabled: account.payouts_enabled,
        ...stripeRequirementStoreUpdate(requirements),
      }).eq('id', store.id)
      if (error) throw error
    }

    const sessionMode = resolveStripeConnectSessionMode(hasExistingManagedAccount, requestedMode)
    const components: Stripe.AccountSessionCreateParams.Components = getStripeConnectSessionComponents(sessionMode)

    const accountSession = await stripe.accountSessions.create({
      account: accountId,
      components,
    })
    return json({ clientSecret: accountSession.client_secret })
  } catch (error) {
    await captureEdgeError('stripe-connect', error)
    console.error('Stripe Connecti käivitamine ebaõnnestus.', error)
    return json({ error: 'Stripe’i ühendamine ebaõnnestus. Palun proovi uuesti.' }, 500)
  }
})
