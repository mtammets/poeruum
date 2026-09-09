import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type Stripe from 'npm:stripe@^22'
import { loadOrderReceipt, parseReceiptAccess, safeCheckoutUrl } from './order-receipt.ts'

const token = 'a'.repeat(64)
const sessionId = 'cs_test_' + 'b'.repeat(40)
const fixture = () => {
  const order = { id: 'order-1', store_id: 'store-1', order_number: 'PR-RECEIPT-1', payment_status: 'pending',
    stripe_mode: 'test', stripe_checkout_session_id: sessionId, stripe_payment_intent_id: null as string | null,
    total: 27.32, product_subtotal: 24, delivery: 'Omniva · Tallinn', created_at: '2026-09-09T12:00:00Z',
    customer_name: 'Private name', customer_email: 'private@example.invalid',
    items: [{ name: 'Kruus', price: 15, salePrice: 12, quantity: 2, selectedOptions: { Värv: 'Sinine' }, image: 'private-url' }] }
  const pi = { id: 'pi_1', status: 'succeeded', livemode: false, currency: 'eur', amount_received: 2732,
    metadata: { order_id: order.id, store_id: order.store_id },
    latest_charge: { status: 'succeeded', paid: true, captured: true, refunded: false, amount_refunded: 0, balance_transaction: null },
    last_payment_error: null as { message: string } | null }
  const session = { id: sessionId, mode: 'payment', livemode: false, metadata: { order_id: order.id, store_id: order.store_id },
    client_reference_id: order.store_id, currency: 'eur', amount_total: 2732, status: 'complete', payment_status: 'paid',
    payment_intent: pi, url: 'https://checkout.stripe.com/c/pay/test' }
  const rpc = vi.fn(async () => { order.payment_status = 'paid'; order.stripe_payment_intent_id = pi.id; return { error: null } })
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {}
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query },
      maybeSingle: async () => ({ error: null, data: table === 'order_receipt_access'
        ? filters.token === token ? { order_id: order.id } : null
        : table === 'stores' ? { name: 'Testipood' }
          : Object.entries(filters).every(([key, value]) => order[key as keyof typeof order] === value) ? { ...order } : null }),
    }
    return query
  })
  const stripe = { checkout: { sessions: { retrieve: vi.fn(async () => session) } }, paymentIntents: { retrieve: vi.fn(async () => pi) } }
  return { order, pi, session, from, rpc, stripe, services: { admin: { from, rpc } as unknown as SupabaseClient, stripe: stripe as unknown as Stripe, mode: 'test' as const } }
}

describe('private order receipts', () => {
  it('accepts only an opaque token or a legacy random session ID, never an order number or success flag', () => {
    expect(parseReceiptAccess({ token })).toEqual({ token })
    expect(parseReceiptAccess({ sessionId })).toEqual({ sessionId })
    for (const value of [null, { checkout: 'success' }, { orderId: 'order-1' }, { orderNumber: 'PR-1' }, { token: 'abc' }, { sessionId: 'cs_test_guess' }, { token, sessionId }]) expect(parseReceiptAccess(value)).toBeNull()
  })
  it('rejects unknown credentials and wrong-mode orders before Stripe or payment confirmation', async () => {
    const f = fixture()
    expect(await loadOrderReceipt(f.services, { token: 'c'.repeat(64) })).toBeNull()
    expect(await loadOrderReceipt(f.services, { sessionId: sessionId + 'c' })).toBeNull()
    f.order.stripe_mode = 'live'
    expect(await loadOrderReceipt(f.services, { token })).toBeNull()
    expect(f.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled()
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('confirms a paid session without waiting for its fee and only returns a minimal order snapshot', async () => {
    const f = fixture()
    const receipt = await loadOrderReceipt(f.services, { token })
    expect(receipt).toMatchObject({ status: 'paid', orderNumber: 'PR-RECEIPT-1', total: 27.32, deliveryTotal: 3.32,
      delivery: 'Omniva · Tallinn', items: [{ name: 'Kruus', unitPrice: 12, quantity: 2, options: { Värv: 'Sinine' } }], resumeUrl: null })
    expect(f.rpc).toHaveBeenCalledWith('complete_stripe_order', { target_order_id: f.order.id, checkout_session_id: sessionId, payment_intent_id: f.pi.id })
    expect(JSON.stringify(receipt)).not.toMatch(/private|pi_1|cs_test|stripe|customer|order-1/)
    await loadOrderReceipt(f.services, { token })
    expect(f.rpc).toHaveBeenCalledTimes(1)
  })
  it.each(['paid', 'refunded'])('reads an already %s order even when Stripe is unavailable', async (status) => {
    const f = fixture()
    f.order.payment_status = status
    expect((await loadOrderReceipt(f.services, { sessionId }))?.status).toBe(status)
    expect(f.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled()
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it.each(['amount', 'currency', 'mode', 'order', 'store', 'session', 'intent'])('rejects mismatched session %s', async (field) => {
    const f = fixture()
    if (field === 'amount') f.session.amount_total = 1
    if (field === 'currency') f.session.currency = 'usd'
    if (field === 'mode') f.session.livemode = true
    if (field === 'order') f.session.metadata = { ...f.session.metadata, order_id: 'other' }
    if (field === 'store') f.session.client_reference_id = 'other'
    if (field === 'session') f.session.id = 'other'
    if (field === 'intent') f.order.stripe_payment_intent_id = 'other'
    await expect(loadOrderReceipt(f.services, { token })).rejects.toThrow('ei ühti')
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('never declares paid after a failed confirmation write', async () => {
    const f = fixture()
    f.rpc.mockRejectedValueOnce(new Error('DB unavailable'))
    await expect(loadOrderReceipt(f.services, { token })).rejects.toThrow('DB unavailable')
    expect(f.order.payment_status).toBe('pending')
  })
  it('does not trust a session paid flag when the actual charge failed or was refunded', async () => {
    const f = fixture()
    f.pi.latest_charge.paid = false
    await expect(loadOrderReceipt(f.services, { token })).rejects.toThrow('maksekanne')
    f.pi.latest_charge.paid = true
    f.pi.latest_charge.amount_refunded = 100
    await expect(loadOrderReceipt(f.services, { token })).rejects.toThrow('tagastatud')
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it.each([
    ['open', 'requires_payment_method', false, 'unpaid', true],
    ['open', 'requires_payment_method', true, 'failed', true],
    ['open', 'requires_action', false, 'unpaid', true],
    ['complete', 'processing', false, 'pending', false],
    ['expired', 'processing', false, 'pending', false],
    ['expired', 'canceled', false, 'expired', false],
  ] as const)('maps %s / %s / error=%s to %s without a new payment', async (sessionStatus, intentStatus, failure, expected, canResume) => {
    const f = fixture()
    f.session.status = sessionStatus; f.session.payment_status = 'unpaid'; f.pi.status = intentStatus
    f.pi.last_payment_error = failure ? { message: 'declined' } : null
    const receipt = await loadOrderReceipt(f.services, { token })
    expect(receipt?.status).toBe(expected)
    expect(Boolean(receipt?.resumeUrl)).toBe(canResume)
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('prefers a concurrent webhook confirmation over an older unpaid Stripe response', async () => {
    const f = fixture()
    f.stripe.checkout.sessions.retrieve.mockImplementationOnce(async () => {
      f.order.payment_status = 'paid'
      return { ...f.session, status: 'open', payment_status: 'unpaid', payment_intent: { ...f.pi, status: 'requires_payment_method' } }
    })
    expect(await loadOrderReceipt(f.services, { token })).toMatchObject({ status: 'paid', resumeUrl: null })
  })
  it('only allows Stripe checkout URLs for resuming the existing payment', () => {
    expect(safeCheckoutUrl('https://checkout.stripe.com/c/pay/test')).toBeTruthy()
    for (const url of ['javascript:alert(1)', 'https://evil.invalid', 'https://checkout.stripe.com.evil.invalid', 'https://user@checkout.stripe.com/c/pay/test', 'http://checkout.stripe.com/c/pay/test']) expect(safeCheckoutUrl(url)).toBeNull()
  })
})
