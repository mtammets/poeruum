import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'npm:stripe@^22'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { recoverOrderPayment, reconcileCheckout, type RecoveryJob } from './payment-recovery.ts'

const fixture = () => {
  const now = Date.parse('2026-09-09T15:00:00Z')
  const order = { id: 'order-1', store_id: 'store-1', total: 27.32, payment_status: 'pending', stripe_mode: 'test',
    stripe_checkout_session_id: 'cs_test_1' as string | null, stripe_payment_intent_id: null as string | null,
    stripe_checkout_started_at: '2026-09-09T14:00:00Z' as string | null,
    created_at: '2026-09-09T14:00:00Z', reservation_expires_at: '2026-09-09T14:35:00Z' }
  const charge = { id: 'ch_1', status: 'succeeded', paid: true, captured: true, refunded: false, amount_refunded: 0 }
  const pi = { id: 'pi_1', status: 'succeeded', currency: 'eur', amount: 2732, amount_received: 2732, livemode: false,
    metadata: { order_id: order.id, store_id: order.store_id }, latest_charge: charge, last_payment_error: null as unknown }
  const session = { id: 'cs_test_1', mode: 'payment', status: 'complete', payment_status: 'paid', livemode: false,
    metadata: { ...pi.metadata }, client_reference_id: order.store_id, currency: 'eur', amount_total: 2732,
    created: Date.parse(order.created_at) / 1000, payment_intent: pi as typeof pi | null }
  const job: RecoveryJob = { order_id: order.id, stripe_mode: 'test', lease_token: 'lease-1', attempts: 1,
    scan_cursor: null, scan_match_id: null, scan_until: null }
  const state = { attempt: { payload: { expires_at: Date.parse('2026-09-09T14:30:00Z') / 1000 } } as Record<string, any> | null,
    stock: 1, jobs: 0, saveFailure: false }
  const rpc = vi.fn(async (name: string, args: Record<string, any>) => {
    if (name === 'complete_stripe_order') {
      if (state.saveFailure) return { data: null, error: { message: 'DB unavailable' } }
      if (order.payment_status !== 'paid' && order.payment_status !== 'refunded') { order.payment_status = 'paid'; state.stock--; state.jobs += 3 }
      order.stripe_payment_intent_id = args.payment_intent_id
    }
    if (name === 'bind_stripe_checkout') order.stripe_checkout_session_id = args.session_id_value
    if (name.startsWith('release_') && order.payment_status === 'pending') order.payment_status = 'failed'
    return { data: null, error: null }
  })
  const admin = { rpc, from: (table: string) => {
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: table === 'orders' ? { ...order } : state.attempt, error: null }) }
    return query
  } } as unknown as SupabaseClient
  const stripe = { checkout: { sessions: { retrieve: vi.fn(async () => session),
    list: vi.fn(async () => ({ data: [session], has_more: false })) } },
    paymentIntents: { retrieve: vi.fn(async () => pi) }, charges: { retrieve: vi.fn(async () => charge) } }
  const services = { admin, stripe: stripe as unknown as Stripe, mode: 'test' as const, now: () => now }
  const run = () => recoverOrderPayment(services, job)
  return { order, charge, pi, session, job, state, rpc, stripe, services, run }
}

describe('automatic payment recovery', () => {
  it('flags incomplete historical payment references instead of claiming recovery succeeded', async () => {
    const f = fixture(); f.order.payment_status = 'paid'
    expect(await f.run()).toBe('needs_review')
    expect(f.state.jobs).toBe(0)
  })
  it('confirms a paid order without a webhook or open browser, once only', async () => {
    const f = fixture()
    expect(await f.run()).toBe('completed')
    expect(f.order.payment_status).toBe('paid')
    expect(f.state.stock).toBe(0)
    expect(f.state.jobs).toBe(3)
    expect(await f.run()).toBe('completed')
    expect(f.state.stock).toBe(0)
    expect(f.state.jobs).toBe(3)
    expect(f.rpc.mock.calls.filter(([name]) => name.startsWith('release_'))).toHaveLength(0)
  })
  it('recovers a lost Checkout binding only after scanning every page', async () => {
    const f = fixture(); f.order.stripe_checkout_session_id = null
    f.stripe.checkout.sessions.list.mockResolvedValueOnce({ data: [f.session], has_more: true })
    expect(await f.run()).toBe('pending')
    expect(f.order.payment_status).toBe('pending')
    const saved = f.rpc.mock.calls.at(-1)![1]
    Object.assign(f.job, { scan_cursor: saved.scan_cursor_value, scan_match_id: saved.scan_match_value, scan_until: saved.scan_until_value })
    f.stripe.checkout.sessions.list.mockResolvedValueOnce({ data: [], has_more: false })
    expect(await f.run()).toBe('completed')
    expect(f.order.stripe_checkout_session_id).toBe(f.session.id)
    expect(f.stripe.checkout.sessions.list.mock.calls[1][0]).toMatchObject({ starting_after: f.session.id })
  })
  it('flags multiple matching sessions instead of selecting one payment', async () => {
    const f = fixture(); f.order.stripe_checkout_session_id = null
    f.stripe.checkout.sessions.list.mockResolvedValueOnce({ data: [f.session, { ...f.session, id: 'cs_other' }], has_more: false })
    expect(await f.run()).toBe('needs_review'); expect(f.state.jobs).toBe(0)
  })
  it('retains an absent session while its original create request can still succeed', async () => {
    const f = fixture(); f.order.stripe_checkout_session_id = null
    f.state.attempt!.payload.expires_at = f.services.now() / 1000 + 1800
    f.stripe.checkout.sessions.list.mockResolvedValue({ data: [], has_more: false })
    expect(await f.run()).toBe('waiting'); expect(f.order.payment_status).toBe('pending')
  })
  it('releases a proven absent expired immutable checkout', async () => {
    const f = fixture(); f.order.stripe_checkout_session_id = null
    f.stripe.checkout.sessions.list.mockResolvedValue({ data: [], has_more: false })
    expect(await f.run()).toBe('completed'); expect(f.order.payment_status).toBe('failed')
    expect(f.rpc).toHaveBeenCalledWith('release_absent_stripe_checkout', expect.any(Object))
  })
  it('restarts an absence scan whose upper bound predates Checkout expiry', async () => {
    const f = fixture(); f.order.stripe_checkout_session_id = null; f.job.scan_until = '2026-09-09T14:05:00Z'
    f.stripe.checkout.sessions.list.mockResolvedValue({ data: [], has_more: false })
    expect(await f.run()).toBe('waiting'); expect(f.order.payment_status).toBe('pending')
    expect(f.rpc.mock.calls.at(-1)![1].scan_until_value).toBeNull()
  })
  it('preserves a legacy unknown attempt for review', async () => {
    const f = fixture(); f.order.stripe_checkout_session_id = null; f.state.attempt = null
    f.stripe.checkout.sessions.list.mockResolvedValue({ data: [], has_more: false })
    expect(await f.run()).toBe('needs_review'); expect(f.order.payment_status).toBe('pending')
  })
  it('reclaims an expired reservation only if no Checkout request ever started', async () => {
    const f = fixture(); f.order.stripe_checkout_session_id = null; f.order.stripe_checkout_started_at = null; f.state.attempt = null
    expect(await f.run()).toBe('completed'); expect(f.order.payment_status).toBe('failed')
    expect(f.stripe.checkout.sessions.list).not.toHaveBeenCalled()
  })
  it.each(['processing', 'requires_capture'])('retains %s payments despite an expired reservation or old failure event', async (status) => {
    const f = fixture(); f.session.payment_status = 'unpaid'; f.pi.status = status; f.session.status = 'expired'
    expect(await f.run()).toBe('waiting'); expect(f.order.payment_status).toBe('pending')
  })
  it('uses current paid state when an old failure event is retried', async () => {
    const f = fixture()
    expect(await reconcileCheckout(f.services, f.order, f.session.id)).toBe('completed')
    expect(f.order.payment_status).toBe('paid')
  })
  it.each(['expired', 'async_failed'])('releases current terminal state: %s', async (kind) => {
    const f = fixture(); f.session.payment_status = 'unpaid'
    if (kind === 'expired') { f.session.status = 'expired'; f.session.payment_intent = null }
    else { f.pi.status = 'requires_payment_method'; f.pi.last_payment_error = { code: 'payment_failed' } }
    expect(await f.run()).toBe('completed'); expect(f.order.payment_status).toBe('failed')
  })
  it('keeps a retryable card failure on an open Checkout reserved', async () => {
    const f = fixture(); f.session.status = 'open'; f.session.payment_status = 'unpaid'; f.pi.status = 'requires_payment_method'; f.pi.last_payment_error = {}
    expect(await f.run()).toBe('waiting'); expect(f.order.payment_status).toBe('pending')
  })
  it('does not reopen an already refunded order or reset its jobs', async () => {
    const f = fixture(); f.order.payment_status = 'refunded'
    expect(await f.run()).toBe('completed')
    expect(f.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled()
    expect(f.state.jobs).toBe(0); expect(f.order.payment_status).toBe('refunded')
  })
  it('flags a payment refunded before local confirmation', async () => {
    const f = fixture(); f.charge.amount_refunded = 2732
    expect(await f.run()).toBe('needs_review'); expect(f.order.payment_status).toBe('pending')
  })
  it.each(['amount', 'mode', 'metadata', 'intent', 'session'])('rejects mismatched %s', async (field) => {
    const f = fixture()
    if (field === 'amount') f.session.amount_total++
    if (field === 'mode') f.session.livemode = true
    if (field === 'metadata') f.session.metadata.store_id = 'other-store'
    if (field === 'intent') f.order.stripe_payment_intent_id = 'pi_other'
    if (field === 'session') f.session.id = 'cs_other'
    expect(await f.run()).toBe('needs_review'); expect(f.state.jobs).toBe(0); expect(f.state.stock).toBe(1)
  })
  it('retries a failed local commit and persists no completion', async () => {
    const f = fixture(); f.state.saveFailure = true
    expect(await f.run()).toBe('retry'); expect(f.state.jobs).toBe(0)
    f.state.saveFailure = false
    expect(await f.run()).toBe('completed'); expect(f.state.jobs).toBe(3)
  })
  it('keeps pagination progress across a provider outage', async () => {
    const f = fixture(); f.order.stripe_checkout_session_id = null; f.job.scan_cursor = 'cs_cursor'; f.job.scan_until = '2026-09-09T15:00:00Z'
    f.stripe.checkout.sessions.list.mockRejectedValueOnce(new Error('Stripe unavailable'))
    expect(await f.run()).toBe('retry')
    expect(f.rpc.mock.calls.at(-1)![1]).toMatchObject({ scan_cursor_value: 'cs_cursor', scan_until_value: f.job.scan_until })
  })
})
