import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'npm:stripe@^22'
import { completePaidStoreOrder } from './store-payment.ts'
import { emailFixture } from './testing/order-email-fixture.ts'

const checkout = {
  orderId: '77000000-0000-4000-8000-000000000003', storeId: '77000000-0000-4000-8000-000000000002', sessionId: 'cs_test_1', paymentIntentId: 'pi_1', mode: 'test' as const,
}

const fixture = () => {
  const email = emailFixture(false)
  const charge = { id: 'ch_1', status: 'succeeded', paid: true, captured: true, refunded: false, amount_refunded: 0 }
  const paymentIntent = { id: 'pi_1', status: 'succeeded', livemode: false, amount_received: 2732, currency: 'eur',
    metadata: { order_id: email.order.id, store_id: email.order.store_id } }
  const stripe = {
    paymentIntents: { retrieve: vi.fn(async () => ({ ...paymentIntent, latest_charge: charge })) },
    charges: { retrieve: vi.fn(async () => charge) },
  }
  const settleOrder = vi.fn(async (): Promise<unknown> => ({ status: 'completed' }))
  const notifyOrder = vi.fn(email.run)
  return { ...email, charge, paymentIntent, stripe, settleOrder, notifyOrder,
    services: { admin: email.admin, stripe: stripe as unknown as Stripe, settleOrder, notifyOrder } }
}

beforeEach(() => {
  vi.stubGlobal('Deno', { env: { get: (key: string) => key === 'RESEND_API_KEY' ? 'test-resend-key' : undefined } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('paid storefront orders', () => {
  it('confirms and emails before a slow settlement finishes, and does not repeat stock or emails', async () => {
    const f = fixture()
    let resume!: (result: unknown) => void
    f.settleOrder.mockImplementationOnce(() => new Promise((resolve) => { resume = resolve }))
    const result = completePaidStoreOrder(f.services, checkout)
    await vi.waitFor(() => expect(f.requests).toHaveLength(2))
    expect(f.order.payment_status).toBe('paid')
    expect(f.requests.map((email) => email.body.to[0])).toEqual(['customer@example.invalid', 'seller@example.invalid'])
    expect(f.requests.every((email) => email.paymentStatus === 'paid')).toBe(true)
    resume({ status: 'waiting_for_fee' })
    await result
    expect(f.order.customer_confirmation_sent_at).toBeTruthy()
    expect(f.order.seller_notification_sent_at).toBeTruthy()
    await completePaidStoreOrder(f.services, checkout)
    expect(f.requests).toHaveLength(2)
    expect(f.state.stock).toBe(1)
    expect(f.settleOrder).toHaveBeenCalledWith(checkout.orderId)
  })

  it.each(['waiting_for_fee', 'retry'])('accepts persisted settlement outcome %s without failing the payment', async (status) => {
    const f = fixture()
    f.settleOrder.mockResolvedValue({ status })
    await completePaidStoreOrder(f.services, checkout)
    expect(f.order.payment_status).toBe('paid')
    expect(f.requests).toHaveLength(2)
  })

  it('starts settlement when email fails and retries the unfinished email', async () => {
    const f = fixture()
    f.state.customerFailure = true
    await completePaidStoreOrder(f.services, checkout)
    expect(f.order.seller_notification_sent_at).toBeTruthy()
    expect(f.settleOrder).toHaveBeenCalledTimes(1)
    expect(f.order.payment_status).toBe('paid')
    expect(f.order.customer_confirmation_sent_at).toBeNull()
    f.state.customerFailure = false
    f.makeDue()
    await completePaidStoreOrder(f.services, checkout)
    expect(f.order.customer_confirmation_sent_at).toBeTruthy()
    expect(f.order.seller_notification_sent_at).toBeTruthy()
    expect(f.state.stock).toBe(1)
  })

  it('awaits notifications and requests a retry if settlement state cannot be persisted', async () => {
    const f = fixture()
    f.settleOrder.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(completePaidStoreOrder(f.services, checkout)).rejects.toThrow('Database unavailable')
    expect(f.requests).toHaveLength(2)
    expect(f.order.payment_status).toBe('paid')
  })

  it.each([
    ['unconfirmed payment', (f: ReturnType<typeof fixture>) => { f.paymentIntent.status = 'processing' }],
    ['wrong mode', (f: ReturnType<typeof fixture>) => { f.paymentIntent.livemode = true }],
    ['wrong amount', (f: ReturnType<typeof fixture>) => { f.paymentIntent.amount_received = 100 }],
    ['wrong currency', (f: ReturnType<typeof fixture>) => { f.paymentIntent.currency = 'usd' }],
    ['wrong order', (f: ReturnType<typeof fixture>) => { f.paymentIntent.metadata.order_id = 'other-order' }],
    ['wrong store', (f: ReturnType<typeof fixture>) => { f.paymentIntent.metadata.store_id = 'other-store' }],
    ['wrong checkout', (f: ReturnType<typeof fixture>) => { f.order.stripe_checkout_session_id = 'cs_other' }],
    ['different existing payment', (f: ReturnType<typeof fixture>) => { f.order.stripe_payment_intent_id = 'pi_other' }],
    ['uncaptured charge', (f: ReturnType<typeof fixture>) => { f.charge.captured = false }],
    ['refunded charge', (f: ReturnType<typeof fixture>) => { f.charge.amount_refunded = 2732 }],
    ['failed database confirmation', (f: ReturnType<typeof fixture>) => { f.state.completionFailure = true }],
  ])('does not confirm, email or transfer for %s', async (_label, change) => {
    const f = fixture()
    change(f)
    await expect(completePaidStoreOrder(f.services, checkout)).rejects.toThrow()
    expect(f.order.payment_status).toBe('pending')
    expect(f.state.stock).toBe(2)
    expect(f.requests).toHaveLength(0)
    expect(f.settleOrder).not.toHaveBeenCalled()
  })

  it('leaves a refunded order unchanged when an older paid event is retried', async () => {
    const f = fixture()
    f.order.payment_status = 'refunded'
    f.order.stripe_payment_intent_id = 'pi_1'
    await completePaidStoreOrder(f.services, checkout)
    expect(f.order.payment_status).toBe('refunded')
    expect(f.rpc).not.toHaveBeenCalled()
    expect(f.requests).toHaveLength(0)
    expect(f.settleOrder).not.toHaveBeenCalled()
  })
})
