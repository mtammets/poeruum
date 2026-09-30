import type Stripe from 'npm:stripe@^22'
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message) }
Deno.test('late refunds and disputes reconcile canonical Stripe state even with follow-up workers paused', async () => {
  const values = { STRIPE_SECRET_KEY: 'sk_test_safeguards', SUPABASE_URL: 'https://safeguards.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'test-secret' }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, Deno.env.get(key)]))
  const fetchBefore = globalThis.fetch
  const observations: Record<string, unknown>[] = []
  let amountRefunded = 10000
  let disputeStatus = 'needs_response'
  let refundStatus = 'succeeded'
  let refundRequests = 0
  try {
    for (const [key, value] of Object.entries(values)) Deno.env.set(key, value)
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin === 'https://api.stripe.com') {
        assert(!init?.method || init.method === 'GET', 'Webhook attempted a money mutation')
        if (url.pathname === '/v1/charges/ch_1') return Response.json({ id: 'ch_1', payment_intent: 'pi_1', currency: 'eur', amount: 10000, amount_refunded: amountRefunded, refunded: amountRefunded === 10000, livemode: false })
        if (url.pathname === '/v1/refunds') return Response.json({ object: 'list', has_more: false, data: [{ id: 're_1', amount: amountRefunded, status: refundStatus }] })
        if (url.pathname === '/v1/disputes/dp_1') return Response.json({ id: 'dp_1', charge: 'ch_1', status: disputeStatus })
      }
      if (url.origin === values.SUPABASE_URL) {
        if (url.pathname.endsWith('/rpc/request_stripe_order_refund')) { refundRequests++; return Response.json({}) }
        if (url.pathname.endsWith('/orders')) return Response.json({ id: 'order-1', total: 100 })
        if (url.pathname.endsWith('/rpc/observe_stripe_order_payment')) { observations.push(JSON.parse(String(init?.body))); return Response.json(null) }
      }
      throw new Error(`Unexpected request: ${url.pathname}`)
    }
    const { handleStorePaymentEvent, isStorePaymentEvent } = await import('../supabase/functions/_shared/stripe-store-events.ts')
    const event = (type: string, object: Record<string, unknown>) => ({ id: 'evt_test', type, livemode: false, data: { object } }) as unknown as Stripe.Event
    assert(!isStorePaymentEvent(event('invoice.paid', {})), 'Billing event intercepted')
    for (const type of ['charge.refunded', 'refund.created', 'refund.updated', 'refund.failed']) {
      await handleStorePaymentEvent(event(type, type.startsWith('refund.') ? { id: 're_1', charge: 'ch_1', amount: 1 } : { id: 'ch_1', amount_refunded: 1 }), false)
      assert(observations.at(-1)?.refunded_cents === 10000 && observations.at(-1)?.full_refund_id === 're_1', 'Late full refund not recorded from current Stripe state')
    }
    refundStatus = 'pending'
    await handleStorePaymentEvent(event('refund.created', { id: 're_1', charge: 'ch_1' }), false)
    assert(observations.at(-1)?.refunded_cents === 0 && refundRequests === 1, 'Pending full refund was treated as completed or not queued')
    refundStatus = 'succeeded'
    amountRefunded = 500
    await handleStorePaymentEvent(event('charge.refunded', { id: 'ch_1' }), false)
    assert(observations.at(-1)?.refunded_cents === 500 && observations.at(-1)?.full_refund_id === null, 'Partial refund treated as full')
    amountRefunded = 0
    for (const status of ['needs_response', 'lost', 'won']) {
      disputeStatus = status
      await handleStorePaymentEvent(event('charge.dispute.closed', { id: 'dp_1', status: 'outdated' }), false)
      assert(observations.at(-1)?.dispute_status_value === status, 'Stale event status used instead of current dispute')
    }
  } finally {
    globalThis.fetch = fetchBefore
    for (const [key,value] of Object.entries(previous)) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key,value) }
  }
})
