import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'

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
    const publicKey = getRequiredEnv('SUPABASE_ANON_KEY')
    const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    const stripe = new Stripe(getRequiredEnv('STRIPE_SECRET_KEY'))

    const userClient = createClient(supabaseUrl, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: store, error: storeError } = await admin.from('stores').select('*').eq('owner_id', user.id).order('created_at').limit(1).maybeSingle()
    if (storeError) throw storeError
    if (!store) return json({ error: 'Pood tuleb enne Stripe’i ühendamist salvestada.' }, 404)

    const body = await request.json().catch(() => ({})) as { action?: string }
    let accountId = typeof store.stripe_account_id === 'string' ? store.stripe_account_id : null

    if (body.action === 'status') {
      if (!accountId) return json({ status: 'idle' })
      const account = await stripe.accounts.retrieve(accountId)
      if ('deleted' in account && account.deleted) {
        await admin.from('stores').update({
          payment_status: 'idle', stripe_account_id: null,
          stripe_account_charges_enabled: false, stripe_account_payouts_enabled: false,
        }).eq('id', store.id)
        return json({ status: 'idle' })
      }
      const status = stripeAccountStatus(account)
      const { error } = await admin.from('stores').update({
        payment_provider: 'stripe', payment_status: status,
        stripe_account_charges_enabled: account.charges_enabled,
        stripe_account_payouts_enabled: account.payouts_enabled,
      }).eq('id', store.id)
      if (error) throw error
      return json({ status, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled })
    }

    if (body.action !== 'start') return json({ error: 'Tundmatu tegevus.' }, 400)

    if (accountId) {
      const existingAccount = await stripe.accounts.retrieve(accountId)
      if ('deleted' in existingAccount && existingAccount.deleted) {
        accountId = null
      } else if (!isPoeruumManagedAccount(existingAccount)) {
        // Standard/Full Dashboard accounts always require a Stripe-hosted login.
        // Keep the old test account intact in Stripe, but replace its Poeruum link
        // with an account whose entire onboarding can run inside Poeruum.
        accountId = null
      }
    }

    if (!accountId) {
      const account = await createPoeruumManagedAccount(stripe, store, user)
      accountId = account.id
      const { error } = await admin.from('stores').update({
        payment_provider: 'stripe', payment_status: 'pending', stripe_account_id: account.id,
        stripe_account_charges_enabled: account.charges_enabled,
        stripe_account_payouts_enabled: account.payouts_enabled,
      }).eq('id', store.id)
      if (error) throw error
    }

    // Keep the Stripe account in sync with information the merchant already
    // entered in Poeruum, including accounts created before prefill was added.
    await stripe.accounts.update(accountId, getStripePrefill(store, user.email ?? ''))

    const accountSession = await stripe.accountSessions.create({
      account: accountId,
      components: {
        account_onboarding: {
          enabled: true,
          features: {
            external_account_collection: true,
            disable_stripe_user_authentication: true,
          },
        },
      },
    })
    return json({ clientSecret: accountSession.client_secret })
  } catch (error) {
    console.error('Stripe Connecti käivitamine ebaõnnestus.', error)
    return json({ error: error instanceof Error ? error.message : 'Stripe’i ühendamine ebaõnnestus.' }, 500)
  }
})
