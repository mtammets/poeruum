import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { deleteRenderCustomDomain } from '../_shared/render-custom-domain.ts'
import { assertStoredStripeMode, assertStripeMode, type StripeMode } from '../_shared/stripe-mode.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

type StorageEntry = { id: string | null; name: string }
type CleanupStatus = 'pending' | 'completed' | 'skipped'

type AccountStore = {
  id: string
  stripe_account_id: string | null
  stripe_account_mode: StripeMode | null
  stripe_customer_id: string | null
  stripe_billing_mode: StripeMode | null
  stripe_subscription_id: string | null
}

const isMissingStripeResource = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
  && (error as { code?: unknown }).code === 'resource_missing'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sisselogimine on nõutud.' }, 401)

    const body = await request.json().catch(() => ({}))
    if (body.confirmation !== 'KUSTUTA') return json({ error: 'Kinnitus puudub.' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const publicKey = Deno.env.get('POERUUM_SUPABASE_PUBLISHABLE_KEY')
    const serviceRoleKey = Deno.env.get('POERUUM_SUPABASE_SECRET_KEY')
    if (!supabaseUrl || !publicKey || !serviceRoleKey) throw new Error('Funktsiooni keskkonnamuutujad puuduvad.')

    const userClient = createClient(supabaseUrl, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: stores, error: storesError } = await admin.from('stores')
      .select('id,stripe_account_id,stripe_account_mode,stripe_customer_id,stripe_billing_mode,stripe_subscription_id')
      .eq('owner_id', user.id)
    if (storesError) throw storesError

    const accountStores = (stores ?? []) as AccountStore[]
    const storeIds = accountStores.map((store) => store.id)

    const stripeResourceIds = accountStores.some((store) =>
      store.stripe_subscription_id || store.stripe_customer_id || store.stripe_account_id)
    let stripe: Stripe | null = null
    let stripeMode: StripeMode | null = null
    if (stripeResourceIds) {
      const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')?.trim()
      if (!stripeSecretKey) throw new Error('Stripe’i seadistus puudub; konto kustutamine peatati enne arvelduse muutmist.')
      stripeMode = assertStripeMode(stripeSecretKey)
      stripe = new Stripe(stripeSecretKey)
    }

    const recordCleanup = async (
      resourceType: 'connected_account' | 'customer',
      resourceId: string,
      mode: StripeMode | null,
      status: CleanupStatus,
      lastError: string | null = null,
    ) => {
      const { error } = await admin.from('external_resource_cleanup').upsert({
        provider: 'stripe',
        resource_type: resourceType,
        resource_id: resourceId,
        mode,
        status,
        last_error: lastError,
        completed_at: status === 'completed' || status === 'skipped' ? new Date().toISOString() : null,
      }, { onConflict: 'provider,resource_type,resource_id' })
      if (error) throw error
    }

    for (const store of accountStores) {
      if (!stripe || !stripeMode) break

      if (store.stripe_subscription_id) {
        assertStoredStripeMode(store.stripe_billing_mode, stripeMode, 'Poe Stripe Billing')
        try {
          const subscription = await stripe.subscriptions.retrieve(store.stripe_subscription_id)
          if (subscription.status !== 'canceled') {
            await stripe.subscriptions.cancel(store.stripe_subscription_id)
          }
        } catch (error) {
          if (!isMissingStripeResource(error)) {
            throw new Error(`Stripe’i subscription’i lõpetamine ebaõnnestus: ${error instanceof Error ? error.message : 'tundmatu viga'}`)
          }
        }
      }

      if (store.stripe_customer_id) {
        assertStoredStripeMode(store.stripe_billing_mode, stripeMode, 'Poe Stripe Billing')
        await recordCleanup('customer', store.stripe_customer_id, store.stripe_billing_mode, 'pending')
        try {
          const deleted = await stripe.customers.del(store.stripe_customer_id)
          await recordCleanup('customer', store.stripe_customer_id, store.stripe_billing_mode, deleted.deleted ? 'completed' : 'pending')
        } catch (error) {
          if (isMissingStripeResource(error)) {
            await recordCleanup('customer', store.stripe_customer_id, store.stripe_billing_mode, 'completed')
          } else {
            await recordCleanup('customer', store.stripe_customer_id, store.stripe_billing_mode, 'pending',
              error instanceof Error ? error.message : 'Stripe’i kliendi kustutamine ebaõnnestus.')
          }
        }
      }

      if (store.stripe_account_id) {
        assertStoredStripeMode(store.stripe_account_mode, stripeMode, 'Poe Stripe’i konto')
        await recordCleanup('connected_account', store.stripe_account_id, store.stripe_account_mode, 'pending')
        try {
          const account = await stripe.accounts.retrieve(store.stripe_account_id)
          if ('deleted' in account && account.deleted) {
            await recordCleanup('connected_account', store.stripe_account_id, store.stripe_account_mode, 'completed')
          } else {
            const isManaged = account.controller?.requirement_collection === 'application'
              && account.controller?.stripe_dashboard?.type === 'none'
            if (!isManaged) {
              await recordCleanup('connected_account', store.stripe_account_id, store.stripe_account_mode, 'skipped',
                'Stripe’i konto kuulub kasutajale ja ühendus eemaldati ainult Poeruumist.')
            } else {
              const deleted = await stripe.accounts.del(store.stripe_account_id)
              await recordCleanup('connected_account', store.stripe_account_id, store.stripe_account_mode,
                deleted.deleted ? 'completed' : 'pending')
            }
          }
        } catch (error) {
          if (isMissingStripeResource(error)) {
            await recordCleanup('connected_account', store.stripe_account_id, store.stripe_account_mode, 'completed')
          } else {
            await recordCleanup('connected_account', store.stripe_account_id, store.stripe_account_mode, 'pending',
              error instanceof Error ? error.message : 'Stripe Connecti konto kustutamine ebaõnnestus.')
          }
        }
      }
    }

    if (storeIds.length) {
      const { data: customDomains, error: domainsError } = await admin.from('custom_domains')
        .select('hostname,provider_domain_id,provider_redirect_domain_id')
        .in('store_id', storeIds)
      if (domainsError) throw domainsError
      for (const domain of customDomains ?? []) {
        await deleteRenderCustomDomain(domain.provider_domain_id || domain.hostname)
        if (domain.provider_redirect_domain_id && domain.provider_redirect_domain_id !== domain.provider_domain_id) {
          await deleteRenderCustomDomain(domain.provider_redirect_domain_id)
        }
      }
    }

    const listFiles = async (bucket: string, prefix: string): Promise<string[]> => {
      const paths: string[] = []
      let offset = 0
      while (true) {
        const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset })
        if (error) throw error
        const entries = (data ?? []) as StorageEntry[]
        for (const entry of entries) {
          const path = `${prefix}/${entry.name}`
          if (entry.id) paths.push(path)
          else paths.push(...await listFiles(bucket, path))
        }
        if (entries.length < 100) break
        offset += entries.length
      }
      return paths
    }

    for (const store of accountStores) {
      const paths = await listFiles('product-images', store.id)
      for (let index = 0; index < paths.length; index += 100) {
        const { error } = await admin.storage.from('product-images').remove(paths.slice(index, index + 100))
        if (error) throw error
      }
    }

    const supportPaths = await listFiles('support-attachments', user.id)
    for (let index = 0; index < supportPaths.length; index += 100) {
      const { error } = await admin.storage.from('support-attachments').remove(supportPaths.slice(index, index + 100))
      if (error) throw error
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
    if (deleteError) throw deleteError
    return json({ success: true })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Konto kustutamine ebaõnnestus.' }, 500)
  }
})
