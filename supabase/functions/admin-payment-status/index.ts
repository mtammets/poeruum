import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'
import { assertStripeMode } from '../_shared/stripe-mode.ts'
import { sellerPayoutAccepted, sellerType } from '../../../shared/seller.ts'
import { payoutBank } from '../_shared/seller-payment-check.ts'
import { livePaymentDiagnostics, matchingPaymentCheck, paymentStoreFields, savedPaymentDiagnostics, type PaymentCheck, type PaymentStore } from '../_shared/admin-payment-status.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const env = (name: string) => { const value = Deno.env.get(name)?.trim(); if (!value) throw new Error(`Missing ${name}`); return value }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sisselogimine on nõutud.' }, 401)
    const client = createClient(env('SUPABASE_URL'), env('POERUUM_SUPABASE_PUBLISHABLE_KEY'), {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: authError } = await client.auth.getUser()
    if (authError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)
    if (user.app_metadata?.role !== 'admin') return json({ error: 'Administraatori ligipääs on nõutud.' }, 403)
    const text = await request.text()
    if (text.length > 25_000) return json({ error: 'Päring on liiga suur.' }, 413)
    let body
    try { body = JSON.parse(text) } catch { return json({ error: 'Vigane päring.' }, 400) }
    const snapshot = body?.action === 'snapshot'
    const ids: unknown = snapshot ? body.userIds : [body?.userId]
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some((id) => typeof id !== 'string' || !uuid.test(id))) return json({ error: 'Vigane kasutaja.' }, 400)
    const limit = await checkRateLimit(request, snapshot ? 'admin-payment-snapshot' : 'admin-payment-live', snapshot ? 120 : 30, 60, user.id)
    if (!limit.allowed) return rateLimitResponse(limit.retry_after_seconds, cors)
    const admin = createClient(env('SUPABASE_URL'), env('POERUUM_SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await admin.from('stores').select(paymentStoreFields).in('owner_id', ids)
    if (error) throw error
    const stores = (data ?? []) as PaymentStore[]
    if (snapshot) {
      if (!stores.length) return json({ diagnostics: [] })
      const { data: checks, error: checksError } = await admin.from('store_payment_checks').select('store_id,account_id,stripe_mode,identity,identity_error,checked_at').in('store_id', stores.map((store) => store.id))
      if (checksError) throw checksError
      return json({ diagnostics: stores.map((store) => savedPaymentDiagnostics(store, matchingPaymentCheck(store, (checks ?? []) as PaymentCheck[]))) })
    }
    if (stores.length !== 1) return json({ error: 'Poodi ei leitud.' }, 404)
    const store = stores[0]
    if (!store.stripe_account_id || store.payment_provider !== 'stripe') return json({ diagnostic: savedPaymentDiagnostics(store) })
    const secret = env('STRIPE_SECRET_KEY')
    if (!store.stripe_account_mode || assertStripeMode(secret) !== store.stripe_account_mode) return json({ error: 'Selle konto Stripe’i režiimi ei saa praeguse ühendusega kontrollida.' }, 409)
    const stripe = new Stripe(secret, { timeout: 12_000, maxNetworkRetries: 0 })
    const account = await stripe.accounts.retrieve(store.stripe_account_id)
    if ('deleted' in account && account.deleted) return json({ error: 'Stripe’i konto on kustutatud. Maksete ühendus vajab uuendamist.' }, 409)
    const diagnostic = livePaymentDiagnostics(store, account)
    if (sellerType(store.settings) === 'entrepreneur') {
      const banks: Stripe.BankAccount[] = []
      for await (const bank of stripe.accounts.listExternalAccounts(account.id, { object: 'bank_account', limit: 100 })) if (bank.object === 'bank_account') banks.push(bank)
      const bank = payoutBank(banks)
      diagnostic.setupError = !sellerPayoutAccepted(store.settings)
        ? 'Kinnita enda aktiivse ettevõtluskonto kasutamine müüja andmetes.'
        : !('id' in bank) || bank.country !== 'EE' || bank.currency !== 'eur'
          ? 'Lisa Stripe’i EUR-väljamaksekontoks enda aktiivne LHV ettevõtluskonto.' : null
    }
    // A replaced connection or changed seller must never receive an older diagnosis.
    const { data: current, error: currentError } = await admin.from('stores').select('stripe_account_id,stripe_account_mode,settings').eq('id', store.id).maybeSingle()
    if (currentError) throw currentError
    if (!current || current.stripe_account_id !== store.stripe_account_id || current.stripe_account_mode !== store.stripe_account_mode || JSON.stringify(current.settings) !== JSON.stringify(store.settings)) return json({ error: 'Maksete ühendus muutus. Uuenda seisu.' }, 409)
    return json({ diagnostic })
  } catch (error) {
    await captureEdgeError('admin-payment-status', error)
    return json({ error: 'Stripe’i täpset seisu ei õnnestunud laadida. Proovi uuesti.' }, 502)
  }
})
