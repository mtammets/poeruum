import Stripe from 'npm:stripe@^22'
type Handler = (request: Request) => Response | Promise<Response>
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }

Deno.test('signed billing events reconcile discounted net revenue and credits once, regardless of delivery order', async () => {
  const originalServe = Deno.serve, originalFetch = globalThis.fetch, originalError = console.error
  const env = { SUPABASE_URL: 'https://billing.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'test-only',
    STRIPE_SECRET_KEY: 'sk_test_local', STRIPE_MODE: 'test', STRIPE_WEBHOOK_SECRET: 'whsec_local_billing' }
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, Deno.env.get(key)]))
  let handler: Handler | undefined, status = 'open', knownStore = true, legacyInvoice = false
  let canonicalReads = 0
  const ledger = new Map<string, Record<string, any>>()
  const credits: Array<Record<string, unknown>> = []
  const paidAt = Math.floor(Date.now() / 1000) - 60
  const parent = { type: 'subscription_details', subscription_details: { subscription: 'sub_1' } }
  const invoice = () => ({ id: 'in_1', customer: 'cus_1', status, livemode: false, currency: 'eur',
    ...(legacyInvoice ? { subscription: 'sub_1' } : { parent }), status_transitions: { paid_at: paidAt },
    subtotal_excluding_tax: 2900, total_excluding_tax: 1450, total: 1798,
    total_taxes: [{ amount: 348 }], amount_paid: 1438, account_tax_ids: ['txi_platform'], billing_reason: 'subscription_cycle' })
  const credit = (id: string, net: number, issued = true) => ({ id, invoice: 'in_1', status: issued ? 'issued' : 'void',
    created: paidAt - 30, total: net + Math.round(net * .24), total_excluding_tax: net,
    total_taxes: [{ amount: Math.round(net * .24) }] })
  try {
    Object.entries(env).forEach(([key, value]) => Deno.env.set(key, value))
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    console.error = () => {}
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin === 'https://api.stripe.com') {
        assert(!init?.method || init.method === 'GET', 'Billing webhook attempted a payment mutation')
        if (url.pathname === '/v1/invoices/in_1') { canonicalReads++; return Response.json(invoice()) }
        if (url.pathname === '/v1/subscriptions/sub_1') return Response.json({ id: 'sub_1', status: 'active' })
        if (url.pathname === '/v1/credit_notes') return Response.json({ object: 'list', data: credits, has_more: false })
      }
      if (url.origin === env.SUPABASE_URL) {
        if (url.pathname.endsWith('/rpc/claim_stripe_webhook')) return Response.json({ state: 'claimed', token: 'claim-token' })
        if (url.pathname.endsWith('/rpc/finish_stripe_webhook') || url.pathname.endsWith('/rpc/record_application_error')) return Response.json(null)
        if (url.pathname.endsWith('/stores')) {
          if (init?.method === 'PATCH') return new Response(null, { status: 204 })
          // First invoice may arrive before checkout stores the subscription.
          return Response.json(knownStore && url.searchParams.has('stripe_customer_id') ? { id: 'store-1', name: 'Pood' } : null)
        }
        if (url.pathname.endsWith('/revenue_events')) {
          const row = JSON.parse(String(init?.body))
          assert(new Headers(init?.headers).get('Prefer')?.includes('resolution=ignore-duplicates'), 'Ledger insert does not deduplicate documents')
          if (!ledger.has(row.provider_event_id)) ledger.set(row.provider_event_id, row)
          return new Response(null, { status: 201 })
        }
      }
      throw new Error(`Unexpected request ${url.pathname}`)
    }
    await import('../supabase/functions/stripe-webhook/index.ts')
    const stripe = new Stripe(env.STRIPE_SECRET_KEY)
    let counter = 0
    const deliver = async (type: string, object: Record<string, unknown>) => {
      const payload = JSON.stringify({ id: `evt_${++counter}`, type, livemode: false, created: paidAt + 60, data: { object } })
      const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: env.STRIPE_WEBHOOK_SECRET })
      const response = await handler!(new Request(`${env.SUPABASE_URL}/functions/v1/stripe-webhook`, {
        method: 'POST', headers: { 'stripe-signature': signature, 'Content-Type': 'application/json' }, body: payload,
      }))
      assert(response.status === 200, `Event ${type} failed: ${await response.text()}`)
    }
    credits.push(credit('cn_prepaid', 290), credit('cn_void', 100, false))
    await deliver('credit_note.created', credits[0])
    await deliver('credit_note.voided', credits[1])
    assert(ledger.size === 0, 'Unpaid invoice credits created negative collected revenue')
    status = 'paid'
    // Credit event precedes invoice.paid and has intentionally stale amounts.
    await deliver('credit_note.created', { ...credits[0], total: 99999 })
    await deliver('invoice.paid', { ...invoice(), total: 99999 })
    await deliver('invoice.paid', invoice())
    assert(ledger.size === 2 && canonicalReads >= 3, 'Canonical invoice/credits were not used or were counted twice')
    const sale = ledger.get('billing-invoice-paid:test:in_1')!
    assert(sale.amount_cents === 1450 && sale.metadata.vat_amount_cents === 348 && sale.metadata.gross_amount_cents === 1798,
      'Discounted invoice used pre-discount subtotal, gross amount or cash paid as net revenue')
    assert([...ledger.values()].reduce((sum, row) => sum + row.amount_cents, 0) === 1160, 'Prepayment credit not deducted exactly once')
    legacyInvoice = true
    credits.push(credit('cn_postpaid', 1160))
    await deliver('credit_note.created', credits[2])
    await deliver('credit_note.created', credits[2])
    assert(ledger.size === 3 && [...ledger.values()].reduce((sum, row) => sum + row.amount_cents, 0) === 0, 'Full credit did not cancel net revenue or old API invoice was ignored')
    knownStore = false
    await deliver('invoice.paid', invoice())
    await deliver('credit_note.created', credits[2])
    await deliver('invoice.paid', { ...invoice(), subscription: null, parent: null })
    assert(ledger.size === 3, 'Foreign or one-off invoice entered Poeruum revenue')
  } finally {
    Deno.serve = originalServe; globalThis.fetch = originalFetch; console.error = originalError
    Object.entries(previous).forEach(([key, value]) => value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value))
  }
})
