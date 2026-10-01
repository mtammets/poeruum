import { PDFDocument, PDFPage } from 'npm:pdf-lib@^1.17.1'
import type Stripe from 'npm:stripe@^22'
import type { InvoiceDocument } from '../shared/order-invoice.ts'
import { PLATFORM_BUSINESS } from '../shared/platform-business.mjs'
import { platformAccountTaxId, prepareSubscriptionInvoice, syncBillingCustomer } from '../supabase/functions/_shared/platform-billing.ts'
import { renderOrderInvoice } from '../supabase/functions/_shared/order-invoice-pdf.ts'

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const buyer = { company: false, name: 'Liisa Tamm', address: 'Kase 1, Tartu', email: 'liisa@example.invalid', registryCode: '', vatNumber: '' }
const fixture = (): InvoiceDocument => ({
  id: '7a000000-0000-4000-8000-000000000003', order_id: '7a000000-0000-4000-8000-000000000004',
  order_number: 'PR-1001', number: 'TEST-PF-2026-000001', kind: 'invoice', original_number: null,
  issued_at: '2026-10-01T07:00:00Z', paid_at: '2026-10-01T06:55:00Z', stripe_mode: 'test',
  status: 'ready', lease_token: null, pdf_sha256: null,
  snapshot: { version: 1, purpose: 'platform_fee', currency: 'eur', seller: { ...PLATFORM_BUSINESS, type: 'company' }, buyer,
    storeName: 'Poeruum', storeSlug: '', storeAccent: '#e5f25a', storeLogo: '', sellerEmail: PLATFORM_BUSINESS.email,
    delivery: 'Digitaalne teenus', vatRate: 24, netCents: 400, vatCents: 96, totalCents: 496,
    lines: [{ kind: 'product', name: 'Poeruumi müügitasu', options: 'Tellimus PR-1001', quantity: 1,
      unitGrossCents: 496, grossCents: 496, netCents: 400, vatCents: 96 }],
  },
})

Deno.test('platform fee invoice and credit show Animaator VAT, merchant buyer, original reference and exact collected amounts', async () => {
  const original = PDFPage.prototype.drawText
  const text: string[] = []
  PDFPage.prototype.drawText = function (value, options) { text.push(value); return original.call(this, value, options) }
  try {
    for (const credit of [false, true]) {
      text.length = 0
      const document = fixture()
      if (credit) { document.kind = 'credit'; document.original_number = document.number; document.number = 'TEST-PF-2026-000002' }
      const pdf = await PDFDocument.load(await renderOrderInvoice(document))
      assert(pdf.getAuthor() === 'Animaator OÜ' && pdf.getPageCount() === 1, 'Wrong invoice issuer or layout')
      assert(text.includes('KMKR: EE103036036') && text.includes('Liisa Tamm'), 'Issuer tax ID or buyer name missing')
      assert(text.includes(credit ? '-4,96 €' : '4,96 €') && text.includes(credit ? '-0,96 €' : '0,96 €'), 'Fee VAT or total differs from captured cents')
      assert(!text.some((line) => line.startsWith('Tarne:') || line === 'Makse on tagastatud.'), 'Goods-delivery or cash-refund wording leaked into fee invoice')
      assert(text.some((line) => line.includes(credit ? 'Algne arve: TEST-PF-2026-000001' : 'tasaarvestusega')), 'Original invoice or settlement method missing')
    }
  } finally { PDFPage.prototype.drawText = original }
})

Deno.test('subscription invoicing requires the platform default VAT identity and refreshes draft buyer data without touching finalised invoices', async () => {
  let defaultIds: string[] = []
  let status = 'draft'
  let customerId = 'cus_buyer'
  const customerWrites: Array<Record<string, any>> = []
  const invoiceWrites: Array<Record<string, any>> = []
  const creates: Array<Record<string, any>> = []
  const deletedIds: string[] = []
  const stripe = {
    accounts: { retrieve: () => ({ settings: { invoices: { default_account_tax_ids: defaultIds } } }) },
    taxIds: { list: async function* () { yield { id: 'txi_platform', type: 'eu_vat', value: PLATFORM_BUSINESS.vatNumber, owner: { type: 'self' } } } },
    customers: {
      create: (data: Record<string, unknown>) => { creates.push(data); return { id: 'cus_buyer' } },
      update: (_id: string, data: Record<string, unknown>) => { customerWrites.push(data); return { id: 'cus_buyer' } },
      listTaxIds: async function* () { yield { id: 'txi_old_company', type: 'eu_vat', value: 'EE123456789' } },
      deleteTaxId: (_id: string, tax: string) => { deletedIds.push(tax) },
      createTaxId: () => { throw new Error('Entrepreneur should not have a customer VAT ID') },
    },
    invoices: {
      retrieve: () => ({ id: 'in_test', status, customer: customerId, livemode: false }),
      update: (_id: string, data: Record<string, unknown>) => { invoiceWrites.push(data) },
    },
  } as unknown as Stripe
  let failed = false
  try { await platformAccountTaxId(stripe) } catch { failed = true }
  assert(failed, 'A non-default tax ID was accepted as complete invoice configuration')
  defaultIds = ['txi_platform']
  const input = { invoiceId: 'in_test', storeId: 'store-1', customerId: 'cus_buyer', buyer, mode: 'test' as const }
  await prepareSubscriptionInvoice(stripe, input)
  assert(customerWrites[0].name === buyer.name && customerWrites[0].address.line1 === buyer.address, 'Legal customer identity was not updated')
  assert(customerWrites[0].invoice_settings.footer.includes(PLATFORM_BUSINESS.address), 'Issuer address missing from Stripe invoice')
  assert(invoiceWrites[0].account_tax_ids[0] === 'txi_platform' && invoiceWrites[0].custom_fields.length === 0, 'Wrong invoice tax identity')
  assert(deletedIds.includes('txi_old_company'), 'Old company VAT ID remained on entrepreneur invoice')
  const writes = customerWrites.length + invoiceWrites.length
  status = 'paid'
  await prepareSubscriptionInvoice(stripe, input)
  assert(customerWrites.length + invoiceWrites.length === writes, 'Finalised invoice or its buyer was changed')
  status = 'draft'; customerId = 'cus_other'
  failed = false
  try { await prepareSubscriptionInvoice(stripe, input) } catch { failed = true }
  assert(failed && customerWrites.length + invoiceWrites.length === writes, 'Foreign invoice was updated')
  await syncBillingCustomer(stripe, { ...input, customerId: null })
  await syncBillingCustomer(stripe, { ...input, customerId: null, buyer: { ...buyer, address: 'Uus 2, Tartu' } })
  assert(JSON.stringify(creates[0]) === JSON.stringify(creates[1]), 'Edited buyer details invalidated stable Stripe customer-creation idempotency')
  assert(customerWrites.at(-1)!.address.line1 === 'Uus 2, Tartu', 'Retried customer creation retained stale invoice address')
})

Deno.test('platform invoice endpoint rejects receipt-token access, other owners and cross-mode PDFs', async () => {
  type Handler = (request: Request) => Response | Promise<Response>
  const originalServe = Deno.serve, originalFetch = globalThis.fetch, originalError = console.error
  let handler: Handler | undefined
  const storeId = '7a000000-0000-4000-8000-000000000002'
  const document = fixture(), bytes = await renderOrderInvoice(document)
  document.pdf_sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const env = { SUPABASE_URL: 'https://platform-invoices.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'test-only', STRIPE_SECRET_KEY: 'sk_test_local', STRIPE_MODE: 'test', RATE_LIMIT_SALT: 'test-salt' }
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, Deno.env.get(key)]))
  let storageReads = 0, mode = 'test'
  try {
    Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value))
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    console.error = () => {}
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      assert(url.origin === env.SUPABASE_URL, 'Unexpected external network call')
      if (url.pathname.endsWith('/auth/v1/user')) return new Headers(init?.headers).get('Authorization') === 'Bearer owner-jwt'
        ? Response.json({ id: 'owner-1' }) : Response.json({ message: 'Invalid token' }, { status: 401 })
      if (url.pathname.endsWith('/rpc/consume_rate_limit')) return Response.json([{ allowed: true, retry_after_seconds: 60 }])
      if (url.pathname.endsWith('/rpc/record_application_error')) return Response.json(null)
      if (url.pathname.endsWith('/stores')) return Response.json(url.searchParams.get('id') === `eq.${storeId}` && url.searchParams.get('owner_id') === 'eq.owner-1' ? { id: storeId } : null)
      if (url.pathname.endsWith('/platform_fee_documents')) {
        assert(url.searchParams.get('store_id') === `eq.${storeId}`, 'Invoice query omitted authorised store')
        if (url.searchParams.get('stripe_mode') !== `eq.${mode}`) return Response.json(null)
        const id = url.searchParams.get('id')
        return Response.json(id ? id === `eq.${document.id}` ? document : null : [document])
      }
      if (url.pathname.includes('/storage/v1/object/')) { storageReads++; return new Response(new Uint8Array(bytes)) }
      throw new Error(`Unexpected request ${url.pathname}`)
    }
    await import('../supabase/functions/platform-invoices/index.ts')
    assert(handler, 'Handler was not registered')
    const request = (body: unknown, jwt?: string) => handler!(new Request(`${env.SUPABASE_URL}/functions/v1/platform-invoices`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body),
    }))
    assert((await request({ storeId, documentId: document.id, token: 'a'.repeat(64) })).status === 401, 'Buyer receipt token exposed platform invoice')
    assert((await request({ storeId }, 'wrong-jwt')).status === 401, 'Invalid JWT accepted')
    assert((await request({ storeId: document.id }, 'owner-jwt')).status === 404, 'Other shop invoices exposed')
    assert((await request({ storeId, documentId: document.order_id }, 'owner-jwt')).status === 404, 'Other invoice ID exposed')
    mode = 'live'
    assert((await request({ storeId, documentId: document.id }, 'owner-jwt')).status === 404, 'Test endpoint exposed live invoice')
    mode = 'test'
    assert(storageReads === 0, 'Unauthorised request read PDF storage')
    const listed = await (await request({ storeId }, 'owner-jwt')).json()
    assert(listed.documents[0].totalCents === 496 && !JSON.stringify(listed).includes('liisa@example.invalid'), 'Invoice list amounts wrong or unnecessary private snapshot returned')
    const response = await request({ storeId, documentId: document.id }, 'owner-jwt')
    assert(response.status === 200 && response.headers.get('Cache-Control') === 'no-store', 'Owner PDF inaccessible or cacheable')
    assert((await response.arrayBuffer()).byteLength === bytes.length, 'PDF bytes changed')
  } finally {
    Deno.serve = originalServe; globalThis.fetch = originalFetch; console.error = originalError
    Object.entries(previous).forEach(([key, value]) => value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value))
  }
})
