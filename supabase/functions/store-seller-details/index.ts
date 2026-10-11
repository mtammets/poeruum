import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { sellerDetailsError } from '../../../shared/seller.ts'
import { cleanSellerSettings, sellerIdentityChanged, sellerSettings, type SellerSettings } from '../../../shared/seller-settings.ts'
import { stripeAccountReady, stripeSellerIdentityError } from '../_shared/stripe-oauth.ts'
import { payoutBank } from '../_shared/seller-payment-check.ts'
import { assertStoredStripeMode, assertStripeMode } from '../_shared/stripe-mode.ts'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const env = (key: string) => { const value = Deno.env.get(key)?.trim(); if (!value) throw new Error(`Missing ${key}`); return value }
const parseSeller = (value: unknown): SellerSettings | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const fields = sellerSettings({})
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !Object.hasOwn(fields, key)) || Object.entries(fields).some(([key, item]) => typeof record[key] !== typeof item)) return null
  if (!['company', 'entrepreneur'].includes(String(record.sellerType))) return null
  return sellerSettings(record)
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Logi sisse.' }, 401)
    const options = { auth: { persistSession: false, autoRefreshToken: false } }
    const userClient = createClient(env('SUPABASE_URL'), env('POERUUM_SUPABASE_PUBLISHABLE_KEY'), { ...options, global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)
    const limit = await checkRateLimit(request, 'store-seller-details', 12, 60, user.id)
    if (!limit.allowed) return rateLimitResponse(limit.retry_after_seconds, headers)
    const body = await request.json().catch(() => null)
    const submitted = parseSeller(body?.seller), expected = parseSeller(body?.expected)
    if (!submitted || !expected || typeof body?.storeId !== 'string') return json({ error: 'Müüja andmed on puudulikud.' }, 400)
    const admin = createClient(env('SUPABASE_URL'), env('POERUUM_SUPABASE_SECRET_KEY'), options)
    const { data: store, error } = await admin.from('stores').select('*').eq('id', body.storeId).eq('owner_id', user.id).maybeSingle()
    if (error) throw error
    if (!store) return json({ error: 'Poodi ei leitud.' }, 404)
    const current = sellerSettings(store.settings)
    if (JSON.stringify(current) !== JSON.stringify(expected)) return json({ error: 'Müüja andmed on vahepeal muutunud. Laadi leht uuesti ja proovi uuesti.' }, 409)
    const next = cleanSellerSettings(submitted)
    if (store.stripe_account_id && (next.sellerType !== current.sellerType || next.registryCode !== current.registryCode)) {
      return json({ error: 'Müüja või registrikoodi vahetamiseks võta ühendust Poeruumi toega.' }, 409)
    }
    const identityChanged = sellerIdentityChanged(current, next)
    const candidate = { ...store.settings, ...next, entrepreneurPayoutAdminException: !identityChanged && store.settings.entrepreneurPayoutAdminException === true }
    const problem = sellerDetailsError(candidate)
    if (problem) return json({ error: problem }, 400)
    let ready: boolean | null = null
    let bank: Record<string, unknown> | null = null
    // Contact and VAT edits do not rewrite or re-verify the Stripe account.
    // Identity edits require a fresh read, and never mutate Stripe or invalidate
    // the active seller if verification fails.
    if (store.stripe_account_id && identityChanged) {
      const secret = env('STRIPE_SECRET_KEY')
      const mode = assertStripeMode(secret)
      assertStoredStripeMode(store.stripe_account_mode, mode, 'Poe Stripe’i konto')
      const stripe = new Stripe(secret, { timeout: 10_000, maxNetworkRetries: 1 })
      const account = await stripe.accounts.retrieve(store.stripe_account_id)
      if ('deleted' in account && account.deleted) return json({ error: 'Stripe’i konto vajab kontrolli. Võta ühendust toega.' }, 409)
      const mismatch = stripeSellerIdentityError(account, candidate)
      if (mismatch) return json({ error: `${mismatch} Muuda andmed esmalt Stripe’is.` }, 409)
      // Missing registration data is not evidence of a match. Existing active
      // accounts keep working, but this route cannot approve a new legal name.
      if (next.sellerType === 'company' && !(account.company as { registration_number?: string } | undefined)?.registration_number) return json({ error: 'Stripe ei tagastanud ettevõtte registrikoodi. Nime muutmise kinnitamiseks võta ühendust Poeruumi toega.' }, 409)
      if (!stripeAccountReady(account)) return json({ error: 'Lõpeta esmalt andmete kontroll Stripe’is. Praegused müüja andmed jäid alles.' }, 409)
      ready = true
      bank = {}
      if (next.sellerType === 'entrepreneur') {
        const banks: Stripe.BankAccount[] = []
        for await (const item of stripe.accounts.listExternalAccounts(account.id, { object: 'bank_account', limit: 100 })) if (item.object === 'bank_account') banks.push(item)
        bank = payoutBank(banks)
        if (!bank.id || bank.country !== 'EE' || bank.currency !== 'eur') return json({ error: 'Kontrolli Stripe’is oma ettevõtluskonto väljamakseandmeid.' }, 409)
      }
    }
    const { data: saved, error: saveError } = await admin.rpc('save_store_seller_details', {
      target_store_id: store.id, owner_id_value: user.id, expected_seller: expected, seller_value: next,
      account_id_value: store.stripe_account_id, account_mode_value: store.stripe_account_mode,
      stripe_ready_value: ready, bank_value: bank,
    })
    if (saveError) {
      if (saveError.message.includes('SELLER_CHANGED')) return json({ error: 'Müüja andmed on vahepeal muutunud. Laadi leht uuesti ja proovi uuesti.' }, 409)
      throw saveError
    }
    return json({ store: saved })
  } catch (error) {
    await captureEdgeError('store-seller-details', error)
    return json({ error: 'Andmete kontrollimine või salvestamine ebaõnnestus. Proovi uuesti.' }, 500)
  }
})
