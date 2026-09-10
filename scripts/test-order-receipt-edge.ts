// Real Edge handlers, Supabase client and Stripe SDK; all network is mocked.
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
  const order = { id: '78000000-0000-4000-8000-000000000003', store_id: '78000000-0000-4000-8000-000000000002',
    order_number: 'PR-EDGE-RECEIPT', payment_status: 'pending', stripe_mode: 'test', stripe_checkout_session_id: null as string | null,
    stripe_payment_intent_id: null as string | null, items: [{ name: 'Test product', price: 27.32, quantity: 1 }],
    product_subtotal: 27.32, total: 27.32, delivery: 'Pickup', created_at: '2026-09-09T12:00:00Z' }
  const pi = { id: 'pi_test_receipt', status: 'succeeded', livemode: false, currency: 'eur', amount_received: 2732,
    metadata: { order_id: order.id, store_id: order.store_id },
    latest_charge: { id: 'ch_test_receipt', status: 'succeeded', paid: true, captured: true, refunded: false, amount_refunded: 0 } }
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
        if (url.pathname.endsWith('/rpc/consume_rate_limit')) return Response.json([{ allowed: rateAllowed, retry_after_seconds: 60 }])
        if (url.pathname.endsWith('/rpc/record_application_error')) return Response.json(null)
        if (url.pathname.endsWith('/rpc/create_stripe_order_with_reservation')) return Response.json({ ...order })
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
        if (url.pathname.endsWith('/rpc/complete_stripe_order')) {
          assert(body.target_order_id === order.id && body.checkout_session_id === sessionId && body.payment_intent_id === pi.id, 'Wrong order confirmed')
          confirmations++; order.payment_status = 'paid'; return Response.json(null)
        }
        if (url.pathname.endsWith('/order_receipt_access')) return Response.json(url.searchParams.get('token') === `eq.${token}` ? { order_id: order.id } : null)
        if (url.pathname.endsWith('/custom_domains')) return Response.json(null)
        if (url.pathname.endsWith('/products')) return Response.json([{ id: 'product-1', name: 'Test product', price: 27.32, stock: 5 }])
        if (url.pathname.endsWith('/stores')) return Response.json({ id: order.store_id, name: 'Receipt store', slug: 'receipt-store',
          payment_provider: 'stripe', payment_status: 'connected', stripe_account_id: 'acct_test', stripe_account_mode: 'test',
          settings: { deliverySettings: { pickupEnabled: true, pickupAddress: 'Testi 1' } } })
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
      customer: { name: 'Test Customer', email: 'test@example.invalid' }, delivery: { type: 'pickup', label: 'Pickup' },
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
