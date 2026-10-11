import { createClient } from 'npm:@supabase/supabase-js@2'
import { parseWithdrawal } from '../../../shared/withdrawal.ts'
import { parseReceiptAccess } from '../_shared/order-receipt.ts'
import { assertStripeMode } from '../_shared/stripe-mode.ts'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'
import { processWithdrawalEmail } from '../_shared/withdrawal-email.ts'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const env = (name: string) => { const value = Deno.env.get(name)?.trim(); if (!value) throw new Error(`Puudub ${name}.`); return value }
const email = (value: unknown) => typeof value === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim()) ? value.trim().toLowerCase() : null

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const raw = await request.text()
    if (raw.length > 12000) return json({ error: 'Avaldus on liiga pikk.' }, 400)
    const body = JSON.parse(raw)
    const input = parseWithdrawal(body)
    if (!input) return json({ error: 'Kontrolli nime, tellimuse andmeid ja e-posti aadressi.' }, 400)
    const ipRate = await checkRateLimit(request, 'order-withdrawal', 10, 600)
    if (!ipRate.allowed) return rateLimitResponse(ipRate.retry_after_seconds, headers)
    const mailRate = await checkRateLimit(request, 'withdrawal-recipient', 5, 3600, input.customerEmail)
    if (!mailRate.allowed) return rateLimitResponse(mailRate.retry_after_seconds, headers)
    const admin = createClient(env('SUPABASE_URL'), env('POERUUM_SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
    const mode = assertStripeMode(env('STRIPE_SECRET_KEY'))
    let storeId: string | null = null, orderId: string | null = null
    const access = body.access ? parseReceiptAccess(body.access) : null
    if (body.access && !access) return json({ error: 'Tellimuse link on vigane.' }, 400)
    if (access) {
      let query = admin.from('orders').select('id,store_id,stripe_mode')
      if ('token' in access) {
        const { data, error } = await admin.from('order_receipt_access').select('order_id').eq('token', access.token).maybeSingle()
        if (error) throw error
        if (!data) return json({ error: 'Tellimuse link ei kehti.' }, 404)
        query = query.eq('id', data.order_id)
      } else query = query.eq('stripe_checkout_session_id', access.sessionId)
      const { data, error } = await query.eq('stripe_mode', mode).maybeSingle()
      if (error) throw error
      if (!data) return json({ error: 'Tellimuse link ei kehti.' }, 404)
      storeId = data.store_id; orderId = data.id
    } else if (typeof body.storeId === 'string' && /^[0-9a-f-]{36}$/i.test(body.storeId)) storeId = body.storeId
    let query = admin.from('stores').select('id,owner_id,name,settings,is_published,stripe_account_mode')
    if (storeId) query = query.eq('id', storeId)
    else if (typeof body.storeSlug === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(body.storeSlug)) query = query.eq('slug', body.storeSlug)
    else return json({ error: 'Poe andmed on puudulikud.' }, 400)
    const { data: store, error: storeError } = await query.maybeSingle()
    if (storeError) throw storeError
    if (!store || (store.stripe_account_mode && store.stripe_account_mode !== mode)) return json({ error: 'Poodi ei leitud.' }, 404)
    if (!access && !store.is_published) {
      const { data, error } = await admin.from('orders').select('id').eq('store_id', store.id).eq('stripe_mode', mode).in('payment_status', ['paid', 'refunded']).limit(1)
      if (error) throw error
      if (!data?.length) return json({ error: 'Poodi ei leitud.' }, 404)
    }
    if (!orderId) {
      const { data, error } = await admin.from('orders').select('id').eq('store_id', store.id).eq('order_number', input.orderReference)
        .eq('stripe_mode', mode).ilike('customer_email', input.customerEmail.replace(/[%_\\]/g, '\\$&')).limit(1)
      if (error) throw error
      orderId = data?.[0]?.id ?? null
    }
    // Always retain the declaration; do not infer the withdrawal deadline from
    // order creation or require the confirmation mailbox to match the purchase.
    const settings = store.settings ?? {}
    let sellerEmail = email(settings.contactEmail) || email(settings.orderNotificationEmail)
    if (!sellerEmail) {
      const { data, error } = await admin.auth.admin.getUserById(store.owner_id)
      if (error) throw error
      sellerEmail = email(data.user?.email)
    }
    if (!sellerEmail) return json({ error: 'Müüja kontakt puudub. Võta ühendust Poeruumi toega.' }, 503)
    const { data, error } = await admin.rpc('submit_store_withdrawal', {
      request_id: input.requestId, target_store_id: store.id, target_order_id: orderId,
      reference_value: input.orderReference, name_value: input.customerName, email_value: input.customerEmail,
      scope_value: input.scope, store_name_value: store.name, seller_email_value: sellerEmail, mode_value: mode,
    })
    if (error?.message?.includes('WITHDRAWAL_REQUEST_CHANGED')) return json({ error: 'Avalduse andmed muutusid. Ava uus avaldus.' }, 409)
    if (error) throw error
    // A queue failure never invalidates a committed declaration. The cron worker
    // retries both mandatory confirmations even when ordinary order email is off.
    const results = await Promise.allSettled([processWithdrawalEmail(admin, mode, data.id), processWithdrawalEmail(admin, mode, data.id)])
    for (const result of results) if (result.status === 'rejected') await captureEdgeError('withdrawal-email', result.reason, { withdrawal_id: data.id }, 'critical')
    return json({ confirmation: { id: data.id, submittedAt: data.submitted_at, statement: data.statement } })
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Avalduse andmed on vigased.' }, 400)
    await captureEdgeError('order-withdrawal', error)
    return json({ error: 'Avalduse esitamine ebaõnnestus. Proovi uuesti.' }, 503)
  }
})
