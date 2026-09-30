// Real Edge handlers, Supabase client and Stripe SDK; all network is mocked.
import type { InvoiceSnapshot } from '../shared/order-invoice.ts'
type Handler = (request: Request) => Response | Promise<Response>
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }

Deno.test('checkout persists its private return link; receipt authorizes, verifies and confirms only the matching order', async () => {
  const originalServe = Deno.serve
  const originalFetch = globalThis.fetch
  const originalError = console.error
  const values: Record<string, string> = {
    SUPABASE_URL: 'https://receipt-test.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'test-only',
    STRIPE_SECRET_KEY: 'sk_test_local', STRIPE_MODE: 'test', RATE_LIMIT_SALT: 'local-test-salt', APP_URL: 'https://poeruum.example.invalid',
    STRIPE_CHECKOUT_ENABLED: 'true',
  }
  const previous = new Map(Object.keys(values).map((key) => [key, Deno.env.get(key)]))
  let handler: Handler | undefined
  const token = 'a'.repeat(64)
  const sessionId = 'cs_test_' + 'b'.repeat(40)
  const order = { invoice_snapshot: null as unknown, id: '78000000-0000-4000-8000-000000000003', store_id: '78000000-0000-4000-8000-000000000002',
    order_number: 'PR-EDGE-RECEIPT', payment_status: 'pending', stripe_mode: 'test', stripe_checkout_session_id: null as string | null,
    stripe_payment_intent_id: null as string | null, items: [{ name: 'Test product', price: 27.32, quantity: 1 }],
    product_subtotal: 27.32, total: 27.32, delivery: 'Pickup', created_at: '2026-09-09T12:00:00Z' }
  const pi = { id: 'pi_test_receipt', status: 'succeeded', livemode: false, currency: 'eur', amount_received: 2732,
    metadata: { order_id: order.id, store_id: order.store_id },
    latest_charge: { created: Math.floor(Date.now() / 1000), id: 'ch_test_receipt', status: 'succeeded', paid: true, captured: true, refunded: false, amount_refunded: 0 } }
  const session = { id: sessionId, mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 2732,
    currency: 'eur', livemode: false, client_reference_id: order.store_id, metadata: pi.metadata, payment_intent: pi }
  let sessionCreate: URLSearchParams | null = null
  let storedAttempt: Record<string, unknown> | null = null
  const checkoutPayloads: string[] = []
  const checkoutKeys: string[] = []
  let loseCreateResponse = false
  let failSessionSave = false
  let rateAllowed = true
  let confirmations = 0
  let stripeReads = 0
  let invalidNetwork = false
  try {
    for (const [key,value] of Object.entries(values)) Deno.env.set(key,value)
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    console.error = () => {}
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const method = init?.method || (input instanceof Request ? input.method : 'GET')
      if (url.origin === 'https://api.stripe.com') {
        if (method === 'GET' && url.pathname === '/v1/accounts/acct_test') return Response.json({ id: 'acct_test', country: 'EE', business_type: 'company', company: { name: 'Receipt OÜ', registration_number: '12345678' }, charges_enabled: true, payouts_enabled: true, capabilities: { transfers: 'active' } })
        if (method === 'POST' && url.pathname === '/v1/checkout/sessions') {
          checkoutPayloads.push(String(init?.body))
          checkoutKeys.push(new Headers(init?.headers).get('idempotency-key') || '')
          if (loseCreateResponse) throw new TypeError('Simulated lost Stripe response')
          sessionCreate = new URLSearchParams(String(init?.body))
          return Response.json({ id: sessionId, url: 'https://checkout.stripe.com/c/pay/test' })
        }
        stripeReads++
        if (method === 'GET' && url.pathname === `/v1/checkout/sessions/${sessionId}`) return Response.json(session)
        if (method === 'GET' && url.pathname === `/v1/payment_intents/${pi.id}`) return Response.json(pi)
      } else if (url.origin === values.SUPABASE_URL) {
        const body = JSON.parse(String(init?.body || '{}'))
        if (url.pathname.endsWith('/rpc/sync_store_payment_check')) return Response.json(true)
        if (url.pathname.endsWith('/rpc/consume_rate_limit')) return Response.json([{ allowed: rateAllowed, retry_after_seconds: 60 }])
        if (url.pathname.endsWith('/rpc/record_application_error')) return Response.json(null)
        if (url.pathname.endsWith('/rpc/create_invoiced_stripe_order')) {
          assert(body.invoice_value.buyer.address === 'Kase 2, Tartu', 'Billing address not snapshotted')
          order.invoice_snapshot ??= body.invoice_value
          return Response.json({ ...order })
        }
        if (url.pathname.endsWith('/rpc/prepare_stripe_checkout')) {
          storedAttempt ??= { payload: body.payload_value, started_at: new Date().toISOString() }
          return Response.json(storedAttempt)
        }
        if (url.pathname.endsWith('/rpc/bind_stripe_checkout')) {
          if (failSessionSave) return Response.json({ message: 'Simulated save failure' }, { status: 500 })
          order.stripe_checkout_session_id = body.session_id_value
          return Response.json(null)
        }
        if (url.pathname.endsWith('/rpc/get_or_create_order_receipt_token')) return Response.json(token)
        if (url.pathname.endsWith('/rpc/complete_invoiced_stripe_order')) {
          assert(body.target_order_id === order.id && body.checkout_session_id === sessionId && body.payment_intent_id === pi.id, 'Wrong order confirmed')
          confirmations++; order.payment_status = 'paid'; return Response.json(null)
        }
        if (url.pathname.endsWith('/order_receipt_access')) return Response.json(url.searchParams.get('token') === `eq.${token}` ? { order_id: order.id } : null)
        if (url.pathname.endsWith('/custom_domains')) return Response.json(null)
        if (url.pathname.endsWith('/products')) return Response.json([{ id: 'product-1', name: 'Test product', price: 27.32, stock: 5 }])
        if (url.pathname.endsWith('/stores')) return Response.json({ id: order.store_id, name: 'Receipt store', slug: 'receipt-store',
          payment_provider: 'stripe', payment_status: 'connected', stripe_account_id: 'acct_test', stripe_account_mode: 'test',
          settings: { businessName: 'Receipt OÜ', registryCode: '12345678', businessAddress: 'Testi 1, Tallinn', contactEmail: 'seller@example.invalid', deliverySettings: { pickupEnabled: true, pickupAddress: 'Testi 1' } } })
        if (url.pathname.endsWith('/orders')) {
          if (method === 'PATCH') {
            if (body.stripe_checkout_session_id && failSessionSave) return Response.json({ message: 'Simulated save failure' }, { status: 500 })
            Object.assign(order, body); return Response.json(null)
          }
          const requestedSession = url.searchParams.get('stripe_checkout_session_id')
          return Response.json(requestedSession && requestedSession !== `eq.${sessionId}` ? null : { ...order })
        }
      }
      invalidNetwork = true
      throw new Error(`Unexpected network call: ${method} ${url.pathname}`)
    }
    await import('../supabase/functions/stripe-store-checkout/index.ts')
    const checkout = handler!
    const checkoutRequest = () => new Request(values.SUPABASE_URL, { method: 'POST', body: JSON.stringify({
      storeId: order.store_id, checkoutRequestId: 'receipt-checkout-request-1', items: [{ id: 'product-1', quantity: 1 }],
      customer: { name: 'Test Customer', email: 'test@example.invalid' }, billing: { company: false, address: 'Kase 2, Tartu' }, delivery: { type: 'pickup', label: 'Pickup' },
    }) })
    Deno.env.set('STRIPE_CHECKOUT_ENABLED', 'false')
    assert((await checkout(checkoutRequest())).status === 503 && checkoutPayloads.length === 0, 'Paused checkout still reached Stripe')
    Deno.env.set('STRIPE_CHECKOUT_ENABLED', 'true')
    loseCreateResponse = true
    assert((await checkout(checkoutRequest())).status === 500, 'Lost Stripe response did not remain retryable')
    assert(order.payment_status === 'pending', 'Lost response released the order')
    loseCreateResponse = false
    failSessionSave = true
    assert((await checkout(checkoutRequest())).status === 500, 'Checkout URL exposed before the session binding was saved')
    failSessionSave = false
    assert((await checkout(checkoutRequest())).status === 200, 'Checkout retry did not succeed')
    assert(sessionCreate, 'Stripe checkout was not created')
    assert(new Set(checkoutPayloads).size === 1 && new Set(checkoutKeys).size === 1 && checkoutKeys[0], 'Retry changed the Stripe payload or idempotency key')
    const params = sessionCreate as unknown as URLSearchParams
    const success = new URL(params.get('success_url')!)
    assert(success.href === params.get('cancel_url'), 'Cancel return still asserts an outcome')
    assert(success.search === '?checkout=status' && success.hash === `#receipt=${token}`, 'Receipt secret not confined to fragment')
    assert(params.get('submit_type') === 'pay', 'Stripe payment confirmation label missing')

    await import('../supabase/functions/order-receipt/index.ts')
    const receipt = handler!
    const request = (body: unknown) => new Request(values.SUPABASE_URL, { method: 'POST', body: JSON.stringify(body) })
    assert((await receipt(new Request(values.SUPABASE_URL))).status === 405, 'GET exposed receipt data')
    assert((await receipt(request({ checkout: 'success', orderId: order.id }))).status === 400, 'An order ID authorized guest access')
    const missing = await receipt(request({ token: 'c'.repeat(64) }))
    assert(missing.status === 404 && stripeReads === 0, 'Unknown token reached Stripe')
    rateAllowed = false
    assert((await receipt(request({ token }))).status === 429, 'Rate limit bypassed')
    rateAllowed = true
    const response = await receipt(request({ token }))
    assert(response.status === 200 && response.headers.get('cache-control') === 'no-store', 'Receipt not private or unavailable')
    assert((await response.json()).receipt.status === 'paid' && confirmations === 1, 'Receipt did not verify and confirm paid checkout')
    assert((await receipt(request({ token }))).status === 200 && confirmations === 1, 'Receipt reload repeated confirmation')
    assert(!invalidNetwork, 'Unexpected money, email or network request')
  } finally {
    Deno.serve = originalServe; globalThis.fetch = originalFetch; console.error = originalError
    for (const [key,value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key,value) }
  }
})

Deno.test('company and entrepreneur checkout amounts match saved documents across buyer, discount and shipping choices', async () => {
  const originalServe = Deno.serve
  const originalFetch = globalThis.fetch
  const values: Record<string, string> = {
    SUPABASE_URL: 'https://pricing-test.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'test-only',
    STRIPE_SECRET_KEY: 'sk_test_local', STRIPE_MODE: 'test', RATE_LIMIT_SALT: 'local-test-salt',
    APP_URL: 'https://poeruum.example.invalid', STRIPE_CHECKOUT_ENABLED: 'true',
  }
  const previous = new Map(Object.keys(values).map(key => [key, Deno.env.get(key)]))
  let handler: Handler | undefined
  let settings: Record<string, unknown> = {}
  let snapshot: InvoiceSnapshot | undefined
  let stripeParams = new URLSearchParams()
  let expectedTotal = 0
  let calls = 0
  try {
    for (const [key, value] of Object.entries(values)) Deno.env.set(key, value)
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin === 'https://api.stripe.com' && url.pathname === '/v1/accounts/acct_pricing') return Response.json({ id: 'acct_pricing', country: 'EE', business_type: settings.sellerType === 'entrepreneur' ? 'individual' : 'company', individual: { first_name: 'Liisa', last_name: 'Tamm' }, company: { name: 'Pood OÜ', registration_number: '12345678' }, charges_enabled: true, payouts_enabled: true, capabilities: { transfers: 'active' } })
      if (url.origin === 'https://api.stripe.com' && url.pathname.endsWith('/external_accounts')) return Response.json({ object: 'list', has_more: false, data: [] })
      if (url.pathname.endsWith('/rpc/sync_store_payment_check')) return Response.json(true) // Approval boundary is covered by SQL safeguards tests.
      if (url.origin === 'https://api.stripe.com' && url.pathname === '/v1/checkout/sessions' && init?.method === 'POST') {
        stripeParams = new URLSearchParams(String(init.body)); calls++
        return Response.json({ id: 'cs_test_pricing', url: 'https://checkout.stripe.com/c/pay/test' })
      }
      if (url.origin !== values.SUPABASE_URL) throw new Error(`Unexpected network: ${url.pathname}`)
      const body = JSON.parse(String(init?.body || '{}'))
      if (url.pathname.endsWith('/rpc/consume_rate_limit')) return Response.json([{ allowed: true }])
      if (url.pathname.endsWith('/rpc/create_invoiced_stripe_order')) {
        assert(body.product_subtotal_value === 31.98 && body.total_value === expectedTotal / 100, 'Database amounts differ from the discounted order')
        snapshot = body.invoice_value
        return Response.json({ id: 'order-pricing', order_number: 'PR-PRICING', payment_status: 'pending',
          stripe_platform_fee_net_cents: 128, stripe_platform_fee_vat_cents: 31 })
      }
      if (url.pathname.endsWith('/rpc/get_or_create_order_receipt_token')) return Response.json('a'.repeat(64))
      if (url.pathname.endsWith('/rpc/prepare_stripe_checkout')) return Response.json({ payload: body.payload_value, started_at: new Date().toISOString() })
      if (url.pathname.endsWith('/rpc/bind_stripe_checkout')) return Response.json(null)
      if (url.pathname.endsWith('/custom_domains')) return Response.json(null)
      if (url.pathname.endsWith('/stores')) return Response.json({ id: 'store-pricing', name: 'Pood', slug: 'pood',
        payment_provider: 'stripe', payment_status: 'connected', stripe_account_id: 'acct_pricing', stripe_account_mode: 'test', settings })
      if (url.pathname.endsWith('/products')) return Response.json([
        { id: 'discount', name: 'Soodustoode', price: 12.40, sale_price: 9.99, stock: 99, options: [{ name: 'Värv', values: ['Sinine'] }] },
        { id: 'extra', name: 'Lisatoode', price: 2.01, stock: 99 },
      ])
      throw new Error(`Unexpected database request: ${url.pathname}`)
    }
    await import(new URL('../supabase/functions/stripe-store-checkout/index.ts?pricing-matrix', import.meta.url).href)
    for (const seller of ['entrepreneur', 'company', 'vat-company']) {
      for (const companyBuyer of [false, true]) {
        for (const shipping of [
          { type: 'pickup', threshold: 0, total: 3198, vat: 619 },
          { type: 'courier', threshold: 0, total: 3798, vat: 735 },
          { type: 'parcel', threshold: 0, total: 3548, vat: 687 },
          { type: 'parcel', threshold: 31.97, total: 3198, vat: 619 },
          { type: 'parcel', threshold: 31.98, total: 3198, vat: 619 },
          { type: 'parcel', threshold: 31.99, total: 3548, vat: 687 },
        ]) {
          const registered = seller === 'vat-company'
          settings = { sellerType: seller === 'entrepreneur' ? 'entrepreneur' : 'company',
            sellerFirstName: 'Liisa', sellerLastName: 'Tamm', businessName: 'Pood OÜ', registryCode: '12345678',
            businessAddress: 'Tallinn', contactEmail: 'seller@example.invalid', vatRegistered: registered,
            vatNumber: registered ? 'EE123456789' : '',
            deliverySettings: { pickupEnabled: true, pickupAddress: 'Tallinn', courierEnabled: true, courierPrice: 6,
              parcelProviders: { omniva: { enabled: true, price: 3.5 } }, freeShippingFrom: shipping.threshold },
          }
          expectedTotal = shipping.total
          snapshot = undefined
          const response = await handler!(new Request(values.SUPABASE_URL, { method: 'POST', body: JSON.stringify({
            storeId: 'store-pricing', checkoutRequestId: `pricing-matrix-request-${calls}`,
            items: [{ id: 'discount', quantity: 3, price: 0, selectedOptions: { Värv: 'Sinine' } }, { id: 'extra', quantity: 1 }],
            customer: { name: 'Mari Kask', email: 'buyer@example.invalid' },
            billing: { company: companyBuyer, name: 'Ostja OÜ', registryCode: '87654321', address: 'Tartu' },
            delivery: { type: shipping.type, provider: 'omniva', label: 'Valitud tarne' },
          }) }))
          assert(response.status === 200, `Checkout failed for ${seller}/${companyBuyer}/${JSON.stringify(shipping)}: ${await response.text()}`)
          const captured = snapshot as InvoiceSnapshot | undefined
          assert(captured?.totalCents === shipping.total && captured.vatCents === (registered ? shipping.vat : 0), 'Invoice total or VAT differs')
          assert(captured!.netCents + captured!.vatCents === expectedTotal, 'Invoice net and VAT do not reconcile')
          assert(captured!.seller.type === settings.sellerType && captured!.buyer.name === (companyBuyer ? 'Ostja OÜ' : 'Mari Kask'), 'Seller or buyer identity changed')
          if (seller === 'entrepreneur') assert(captured!.seller.registryCode === '' && captured!.seller.vatNumber === '' && captured!.vatRate === null, 'Individual acquired company tax fields')
          let stripeTotal = 0
          for (let index = 0; stripeParams.has(`line_items[${index}][quantity]`); index++) {
            stripeTotal += Number(stripeParams.get(`line_items[${index}][quantity]`)) * Number(stripeParams.get(`line_items[${index}][price_data][unit_amount]`))
          }
          assert(stripeTotal === expectedTotal, 'Stripe charges a different amount than the document')
          assert(stripeParams.get('payment_intent_data[metadata][platform_fee_cents]') === '159', 'Seller VAT status changed the platform service fee')
          assert(stripeParams.get('line_items[0][price_data][product_data][description]') === 'Värv: Sinine', 'Product option lost')
        }
      }
    }
    assert(calls === 36, 'Not all checkout scenarios reached Stripe')
  } finally {
    Deno.serve = originalServe; globalThis.fetch = originalFetch
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value) }
  }
})
