import { createClient } from 'npm:@supabase/supabase-js@2'
import type { InvoiceDocument } from '../../../shared/order-invoice.ts'
import { readDocumentPdf, processOrderDocument, documentFilename } from '../_shared/order-documents.ts'
import { assertStripeMode } from '../_shared/stripe-mode.ts'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'

const headers = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'Content-Disposition',
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })
const env = (key: string) => { const value = Deno.env.get(key)?.trim(); if (!value) throw new Error(`Puudub ${key}`); return value }
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const jwt = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]
    if (!jwt) return json({ error: 'Logi sisse.' }, 401)
    const admin = createClient(env('SUPABASE_URL'), env('POERUUM_SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: auth, error: authError } = await admin.auth.getUser(jwt)
    if (authError || !auth.user) return json({ error: 'Logi sisse.' }, 401)
    const body = await request.json().catch(() => null)
    const offset = body?.offset ?? 0
    if (!uuid(body?.storeId) || (body.documentId !== undefined && !uuid(body.documentId))
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return json({ error: 'Vigane päring.' }, 400)
    const rate = await checkRateLimit(request, 'platform-invoices', 60, 60, auth.user.id)
    if (!rate.allowed) return rateLimitResponse(rate.retry_after_seconds, headers)
    const { data: store, error: storeError } = await admin.from('stores').select('id')
      .eq('id', body.storeId).eq('owner_id', auth.user.id).maybeSingle()
    if (storeError) throw storeError
    if (!store) return json({ error: 'Arveid ei leitud.' }, 404)
    const mode = assertStripeMode(env('STRIPE_SECRET_KEY'))
    if (!body.documentId) {
      const { data, error } = await admin.from('platform_fee_documents')
        .select('id,number,kind,issued_at,snapshot,status').eq('store_id', store.id).eq('stripe_mode', mode)
        .order('issued_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49)
      if (error) throw error
      return json({ documents: (data ?? []).map((doc) => ({ id: doc.id, number: doc.number, kind: doc.kind,
        issuedAt: doc.issued_at, totalCents: doc.snapshot.totalCents, ready: doc.status === 'ready' })), hasMore: data?.length === 50 })
    }
    const read = async () => {
      const { data, error } = await admin.from('platform_fee_documents').select('*')
        .eq('store_id', store.id).eq('stripe_mode', mode).eq('id', body.documentId).maybeSingle()
      if (error) throw error
      return data as InvoiceDocument | null
    }
    let document = await read()
    if (!document) return json({ error: 'Arvet ei leitud.' }, 404)
    if (document.status !== 'ready') {
      await processOrderDocument(admin, mode, document.id, undefined, 'platform_fee')
      document = await read()
    }
    if (!document || document.status !== 'ready') return json({ error: 'Arvet koostatakse. Proovi mõne hetke pärast uuesti.' }, 409)
    return new Response(new Uint8Array(await readDocumentPdf(admin, document)), { headers: {
      ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${documentFilename(document)}"`,
    } })
  } catch (error) {
    await captureEdgeError('platform-invoices', error)
    return json({ error: 'Poeruumi arvete laadimine ebaõnnestus.' }, 500)
  }
})
