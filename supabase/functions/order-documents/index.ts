import { createClient } from 'npm:@supabase/supabase-js@2'
import type { InvoiceDocument } from '../../../shared/order-invoice.ts'
import { parseReceiptAccess } from '../_shared/order-receipt.ts'
import { readDocumentPdf, documentFilename } from '../_shared/order-documents.ts'
import { assertStripeMode } from '../_shared/stripe-mode.ts'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Disposition',
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })
const env = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body || (body.documentId !== undefined && !uuid(body.documentId))) return json({ error: 'Arve päring on vigane.' }, 400)
    const access = parseReceiptAccess(body)
    if (!access && (!uuid(body.storeId) || typeof body.orderNumber !== 'string' || body.orderNumber.length > 100)) return json({ error: 'Tellimuse ligipääsuandmed puuduvad.' }, 400)
    const rate = await checkRateLimit(request, 'order-documents', 60, 60)
    if (!rate.allowed) return rateLimitResponse(rate.retry_after_seconds, headers)
    const admin = createClient(env('SUPABASE_URL'), env('POERUUM_SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
    const mode = assertStripeMode(env('STRIPE_SECRET_KEY'))
    let query = admin.from('orders').select('id').eq('stripe_mode', mode)
    if (access && 'token' in access) {
      const { data, error } = await admin.from('order_receipt_access').select('order_id').eq('token', access.token).maybeSingle()
      if (error) throw error
      if (!data) return json({ error: 'Tellimust ei leitud.' }, 404)
      query = query.eq('id', data.order_id)
    } else if (access && 'sessionId' in access) query = query.eq('stripe_checkout_session_id', access.sessionId)
    else {
      const jwt = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]
      if (!jwt) return json({ error: 'Logi sisse.' }, 401)
      const { data: auth, error: authError } = await admin.auth.getUser(jwt)
      if (authError || !auth.user) return json({ error: 'Logi sisse.' }, 401)
      const { data: store, error } = await admin.from('stores').select('id').eq('id', body.storeId).eq('owner_id', auth.user.id).maybeSingle()
      if (error) throw error
      if (!store) return json({ error: 'Tellimust ei leitud.' }, 404)
      query = query.eq('store_id', store.id).eq('order_number', body.orderNumber)
    }
    const { data: order, error } = await query.maybeSingle()
    if (error) throw error
    if (!order) return json({ error: 'Tellimust ei leitud.' }, 404)
    if (body.documentId) {
      const { data, error } = await admin.from('order_documents').select('*').eq('order_id', order.id).eq('id', body.documentId).eq('stripe_mode', mode).maybeSingle()
      if (error) throw error
      if (!data) return json({ error: 'Arvet ei leitud.' }, 404)
      const document = data as InvoiceDocument
      if (document.status !== 'ready') return json({ error: 'Arvet koostatakse. Proovi mõne hetke pärast uuesti.' }, 409)
      const bytes = await readDocumentPdf(admin, document)
      return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${documentFilename(document)}"` } })
    }
    const { data: documents, error: listError } = await admin.from('order_documents').select('id,number,kind,status')
      .eq('order_id', order.id).eq('stripe_mode', mode).order('issued_at')
    if (listError) throw listError
    return json({ documents: (documents ?? []).map((doc) => ({ id: doc.id, number: doc.number, kind: doc.kind, ready: doc.status === 'ready' })) })
  } catch (error) {
    await captureEdgeError('order-documents', error)
    return json({ error: 'Arvete laadimine ebaõnnestus. Proovi uuesti.' }, 503)
  }
})
