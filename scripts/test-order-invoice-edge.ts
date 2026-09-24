// Offline tests: real PDF renderer and HTTP handlers, no live payments/emails.
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'npm:pdf-lib@^1.17.1'
import { buildInvoiceSnapshot, parseInvoiceBuyer, type InvoiceDocument } from '../shared/order-invoice.ts'
import { renderOrderInvoice } from '../supabase/functions/_shared/order-invoice-pdf.ts'
import { processOrderDocument, readDocumentPdf } from '../supabase/functions/_shared/order-documents.ts'
import { buildOrderDocumentEmail } from '../supabase/functions/_shared/order-document-email.ts'
import { invoiceLogoFixtures } from './fixtures/invoice-logo.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const fixture = (): InvoiceDocument => ({
  id: '79000000-0000-4000-8000-000000000003', order_id: '79000000-0000-4000-8000-000000000004',
  order_number: 'PR-ARVE-TEST', number: 'TEST-2026-000001', kind: 'invoice', original_number: null,
  issued_at: '2026-09-24T12:00:00Z', paid_at: '2026-09-24T11:55:00Z', stripe_mode: 'test',
  status: 'pending', lease_token: null, pdf_sha256: null,
  snapshot: buildInvoiceSnapshot({
    settings: { businessName: 'Õie & Ženja OÜ', registryCode: '12345678', businessAddress: 'Pärna 1, Tallinn, 10111', contactEmail: 'pood@example.invalid', vatRegistered: true, vatNumber: 'EE123456789' },
    buyer: parseInvoiceBuyer({ company: true, name: 'Ostja OÜ', registryCode: '87654321', address: 'Kase 2, Tartu, 50111' }, { name: 'Õie', email: 'ostja@example.invalid' }),
    storeName: 'Õie pood', storeSlug: 'oie-pood', delivery: 'Omniva · Tartu kesklinn', deliveryCents: 372,
    items: [{ name: 'Käsitöökruus', options: 'Värv: sinine', quantity: 2, unitGrossCents: 1240 }],
  }),
})

Deno.test('PDF invoices embed Estonian text and paginate long orders; credits retain their original reference', async () => {
  const invoice = fixture()
  const bytes = await renderOrderInvoice(invoice)
  const pdf = await PDFDocument.load(bytes)
  assert(pdf.getPageCount() === 1, 'A short invoice should fit one page')
  assert(pdf.getTitle() === 'Arve TEST-2026-000001', 'Invoice title missing')
  assert(pdf.getAuthor() === 'Õie & Ženja OÜ', 'Estonian seller name lost')
  assert(bytes.length < 300_000, 'Font subsetting failed')
  const long = fixture()
  long.snapshot.lines = Array.from({ length: 51 }, (_, index) => ({ ...long.snapshot.lines[0], name: `Toode ${index} · ${'väga pikk tootenimetus '.repeat(20)}`, options: 'Suurus: M; värv: sinine' }))
  const longPdf = await PDFDocument.load(await renderOrderInvoice(long))
  assert(longPdf.getPageCount() > 2, 'Long rows must paginate')
  const credit = { ...invoice, kind: 'credit' as const, number: 'TEST-2026-000002', original_number: invoice.number }
  assert((await PDFDocument.load(await renderOrderInvoice(credit))).getTitle() === 'Kreeditarve TEST-2026-000002', 'Credit title incorrect')
})

const logoOrigin = 'https://invoice-logo.example.invalid'
const logoPath = '/storage/v1/object/public/product-images/79000000-0000-4000-8000-000000000002/assets/logo.webp'
const logoBytes = (format: keyof typeof invoiceLogoFixtures) => Uint8Array.from(atob(invoiceLogoFixtures[format]), (character) => character.charCodeAt(0))
const imageObjects = (pdf: PDFDocument) => pdf.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)

Deno.test('invoice and credit headers embed stored PNG, JPEG and WebP logos with transparency', async () => {
  const originalFetch = globalThis.fetch
  const previousUrl = Deno.env.get('SUPABASE_URL')
  let format: keyof typeof invoiceLogoFixtures = 'png'
  let requests = 0
  try {
    Deno.env.set('SUPABASE_URL', logoOrigin)
    globalThis.fetch = async (input, options) => {
      assert(String(input) === `${logoOrigin}${logoPath}`, 'Renderer fetched a URL outside the captured logo')
      assert(options?.redirect === 'error' && options.credentials === 'omit', 'Logo fetch must not forward credentials or redirects')
      requests++
      return new Response(logoBytes(format))
    }
    for (const candidate of ['png', 'jpeg', 'webp'] as const) {
      format = candidate
      const document = fixture()
      document.snapshot.storeLogo = `${logoOrigin}${logoPath}`
      const pdf = await PDFDocument.load(await renderOrderInvoice(document))
      assert(pdf.getPageCount() === 1, 'Adding the logo pushed a short invoice onto another page')
      const images = imageObjects(pdf)!
      assert(images?.keys().length === 1, `${format} logo is missing from the PDF page`)
      const image = images.lookup(images.keys()[0])
      if (!(image instanceof PDFRawStream)) throw new Error('Logo is not an embedded image stream')
      assert(image.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber() === 120, 'Logo width changed')
      assert(image.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber() === 40, 'Logo height changed')
      if (format !== 'jpeg') assert(image.dict.has(PDFName.of('SMask')), 'Transparent logo was flattened')
      if (format === 'webp') {
        const credit = await PDFDocument.load(await renderOrderInvoice({ ...document, kind: 'credit', original_number: document.number }))
        assert(imageObjects(credit)?.keys().length === 1, 'Credit logo is missing')
      }
    }
    assert(requests === 4, 'The WebP codec fetched a runtime asset or the renderer fetched the logo again')
  } finally {
    globalThis.fetch = originalFetch
    if (previousUrl === undefined) Deno.env.delete('SUPABASE_URL'); else Deno.env.set('SUPABASE_URL', previousUrl)
  }
})

Deno.test('unavailable, invalid, oversized and external logos leave a usable invoice without an image', async () => {
  const originalFetch = globalThis.fetch
  const previousUrl = Deno.env.get('SUPABASE_URL')
  const assertNoLogo = async (url: string) => {
    const document = fixture()
    document.snapshot.storeLogo = url
    const pdf = await PDFDocument.load(await renderOrderInvoice(document))
    assert(pdf.getTitle() === `Arve ${document.number}` && pdf.getPageCount() === 1, 'Optional branding prevented invoice generation')
    assert(!imageObjects(pdf)?.keys().length, 'Rejected logo was embedded')
  }
  try {
    Deno.env.set('SUPABASE_URL', logoOrigin)
    let requests = 0
    globalThis.fetch = async () => { requests++; throw new Error('Unexpected logo request') }
    for (const url of ['', `https://other.example.invalid${logoPath}`, `http://127.0.0.1${logoPath}`,
      `${logoOrigin}/auth/v1/user`, `${logoOrigin}${logoPath}?redirect=https://other.example.invalid`,
      `${logoOrigin}/storage/v1/object/public/product-images/79000000-0000-4000-8000-000000000002/assets/%2e%2e%2flogo.webp`]) await assertNoLogo(url)
    assert(requests === 0, 'Untrusted URL triggered a server-side request')
    const url = `${logoOrigin}${logoPath}`
    const tooWide = logoBytes('png')
    new DataView(tooWide.buffer).setUint32(16, 100_000)
    for (const response of [new Response(null, { status: 404 }), new Response('not an image'),
      new Response(logoBytes('png').slice(0, 24)), new Response(tooWide),
      new Response(logoBytes('png'), { headers: { 'Content-Length': String(3 * 1024 * 1024) } }),
      new Response(new Uint8Array(2 * 1024 * 1024 + 1))]) {
      globalThis.fetch = async () => response
      await assertNoLogo(url)
    }
    globalThis.fetch = async () => { throw new TypeError('Redirect or network failure') }
    await assertNoLogo(url)
    let aborted = false
    globalThis.fetch = (_input, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('Timeout', 'AbortError')) }, { once: true })
    })
    await assertNoLogo(url)
    assert(aborted, 'A slow logo fetch did not respect the timeout')
  } finally {
    globalThis.fetch = originalFetch
    if (previousUrl === undefined) Deno.env.delete('SUPABASE_URL'); else Deno.env.set('SUPABASE_URL', previousUrl)
  }
})

Deno.test('document upload and immutable email attachment recover from lost responses and stale leases', async () => {
  let document = fixture()
  let stored: Uint8Array | null = null
  let renders = 0
  let failAcceptance = true
  let stale = false
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_order_document') {
        if (document.status === 'ready') return { data: [] }
        document = { ...document, status: 'processing', lease_token: crypto.randomUUID() }
        return { data: [structuredClone(document)] }
      }
      if (name === 'finish_order_document') {
        if (stale || args.token_value !== document.lease_token) return { error: new Error('DOCUMENT_LEASE_LOST') }
        if (args.outcome_value === 'ready' && failAcceptance) { failAcceptance = false; return { error: new Error('DB write lost') } }
        document = { ...document, status: args.outcome_value as InvoiceDocument['status'], pdf_sha256: args.sha256_value as string | null }
        return { data: structuredClone(document) }
      }
      throw new Error(`Unexpected RPC ${name}`)
    },
    storage: { from: () => ({
      download: () => stored ? { data: new Blob([new Uint8Array(stored)]) } : { data: null, error: { statusCode: '404' } },
      upload: (_path: string, bytes: Uint8Array, options: { upsert: boolean }) => {
        assert(!options.upsert, 'Issued PDFs must never be overwritten')
        stored = new Uint8Array(bytes)
        return { error: new Error('Upload response lost') }
      },
    }) },
    from: (table: string) => {
      const query = { select: () => query, eq: () => query,
        single: () => ({ data: table === 'order_documents' ? structuredClone(document) : { token: 'a'.repeat(64) } }) }
      return query
    },
  } as unknown as SupabaseClient
  const render = async (doc: InvoiceDocument) => { renders++; return renderOrderInvoice(doc) }
  assert((await processOrderDocument(admin, 'test', document.id, render))?.status === 'retry', 'Lost DB write must retry')
  const original = new Uint8Array(stored!)
  assert((await processOrderDocument(admin, 'test', document.id, render))?.status === 'ready', 'Upload recovery failed')
  assert(renders === 1, 'Retry regenerated the issued PDF')
  assert((await readDocumentPdf(admin, document)).every((byte, index) => byte === original[index]), 'Stored PDF changed')
  const previousUrl = Deno.env.get('APP_URL')
  Deno.env.set('APP_URL', 'https://poeruum.example.invalid')
  try {
    const email = await buildOrderDocumentEmail(admin, document.order_id, 'customer', 'job-customer', false)
    assert(email.attachments?.[0].filename === 'Arve-TEST-2026-000001.pdf', 'Invoice attachment missing')
    assert(email.to[0] === document.snapshot.buyer.email, 'Wrong invoice recipient')
    assert(email.html.includes('Õie &amp; Ženja'), 'Seller HTML is not escaped')
    assert(email.html.includes('/p/oie-pood?checkout=status#receipt='), 'Private receipt link missing')
    const decoded = Uint8Array.from(atob(email.attachments![0].content), (character) => character.charCodeAt(0))
    assert(decoded.every((byte, index) => byte === original[index]), 'Email did not attach the stored PDF')
    document = { ...document, kind: 'credit', original_number: document.number, number: 'TEST-2026-000002' }
    const credit = await buildOrderDocumentEmail(admin, document.order_id, 'customer_credit', 'job-credit', true)
    assert(credit.tags[0].value === 'order_customer_credit' && credit.subject.includes('Kreeditarve'), 'Credit routing incorrect')
    assert(credit.text.includes('-28,52'), 'Credit total must be negative')
  } finally { if (previousUrl === undefined) Deno.env.delete('APP_URL'); else Deno.env.set('APP_URL', previousUrl) }
  stored![20] ^= 1
  let corruptRejected = false
  try { await readDocumentPdf(admin, document) } catch { corruptRejected = true }
  assert(corruptRejected, 'Changed stored PDF was not rejected')
  document.status = 'retry'; stale = true
  let staleRejected = false
  try { await processOrderDocument(admin, 'test', document.id, render) } catch { staleRejected = true }
  assert(staleRejected, 'Stale lease finalized an invoice')
})

Deno.test('document endpoint verifies receipt credentials, shop ownership, order identity and Stripe mode before reading PDF', async () => {
  type Handler = (request: Request) => Response | Promise<Response>
  const originalServe = Deno.serve
  const originalFetch = globalThis.fetch
  const originalError = console.error
  let handler: Handler | undefined
  const token = 'a'.repeat(64)
  const storeId = '79000000-0000-4000-8000-000000000002'
  const document = fixture()
  const bytes = await renderOrderInvoice(document)
  document.status = 'ready'
  document.pdf_sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const env = { SUPABASE_URL: 'https://invoice-test.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'test-only', STRIPE_SECRET_KEY: 'sk_test_local', STRIPE_MODE: 'test', RATE_LIMIT_SALT: 'test-salt' }
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, Deno.env.get(key)]))
  let storageReads = 0
  let mode = 'test'
  try {
    Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value))
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    console.error = () => {}
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      assert(url.origin === env.SUPABASE_URL, 'Unexpected external network call')
      const path = url.pathname
      if (path.endsWith('/rpc/consume_rate_limit')) return Response.json([{ allowed: true, retry_after_seconds: 60 }])
      if (path.endsWith('/rpc/record_application_error')) return Response.json(null)
      if (path.endsWith('/auth/v1/user')) return new Headers(init?.headers).get('Authorization') === 'Bearer owner-jwt'
        ? Response.json({ id: 'owner-1' }) : Response.json({ message: 'Invalid token' }, { status: 401 })
      if (path.endsWith('/order_receipt_access')) return Response.json(url.searchParams.get('token') === `eq.${token}` ? { order_id: document.order_id } : null)
      if (path.endsWith('/stores')) return Response.json(url.searchParams.get('id') === `eq.${storeId}` && url.searchParams.get('owner_id') === 'eq.owner-1' ? { id: storeId } : null)
      if (path.endsWith('/orders')) return Response.json(url.searchParams.get('stripe_mode') === `eq.${mode}` ? { id: document.order_id } : null)
      if (path.endsWith('/order_documents')) {
        assert(url.searchParams.get('order_id') === `eq.${document.order_id}`, 'Document query omitted authorized order')
        const id = url.searchParams.get('id')
        return Response.json(id ? id === `eq.${document.id}` ? document : null : [{ id: document.id, number: document.number, kind: document.kind, status: 'ready' }])
      }
      if (path.includes('/storage/v1/object/')) { storageReads++; return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf' } }) }
      throw new Error(`Unexpected request ${path}`)
    }
    await import('../supabase/functions/order-documents/index.ts')
    assert(handler, 'Document handler missing')
    const request = (body: unknown, jwt?: string) => handler!(new Request(`${env.SUPABASE_URL}/functions/v1/order-documents`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }))
    assert((await request({ documentId: document.id })).status === 400, 'Order ID alone authorized a document')
    assert((await request({ token: 'b'.repeat(64), documentId: document.id })).status === 404, 'Wrong receipt credential accepted')
    assert((await request({ storeId, orderNumber: document.order_number })).status === 401, 'Anonymous merchant request accepted')
    assert((await request({ storeId, orderNumber: document.order_number }, 'bad-jwt')).status === 401, 'Invalid JWT accepted')
    assert((await request({ storeId: document.id, orderNumber: document.order_number }, 'owner-jwt')).status === 404, 'Other shop invoice exposed')
    assert((await request({ token, documentId: document.order_id })).status === 404, 'Other order document exposed')
    mode = 'live'
    assert((await request({ token, documentId: document.id })).status === 404, 'Cross-mode invoice exposed')
    mode = 'test'
    assert(storageReads === 0, 'Unauthorized request read storage')
    const listing = await request({ token })
    assert((await listing.json()).documents[0].ready, 'Ready invoice not listed')
    const download = await request({ token, documentId: document.id })
    assert(download.status === 200 && download.headers.get('Content-Type') === 'application/pdf', 'PDF download failed')
    assert(download.headers.get('Cache-Control') === 'no-store' && download.headers.get('Content-Disposition')?.includes('attachment'), 'Private download headers missing')
    assert((await download.arrayBuffer()).byteLength === bytes.length, 'Downloaded PDF changed')
    assert((await request({ storeId, orderNumber: document.order_number, documentId: document.id }, 'owner-jwt')).status === 200, 'Owner download denied')
  } finally {
    Deno.serve = originalServe; globalThis.fetch = originalFetch; console.error = originalError
    Object.entries(previous).forEach(([key, value]) => value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value))
  }
})
