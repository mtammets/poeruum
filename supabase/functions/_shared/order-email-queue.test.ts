import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { processOrderEmail, recordOrderEmailEvent } from './order-email-queue.ts'
import { emailFixture } from './testing/order-email-fixture.ts'

beforeEach(() => vi.stubGlobal('Deno', { env: { get: (key: string) => key === 'RESEND_API_KEY' ? 'test-only-key' : undefined } }))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('independent order email jobs', () => {
  it('does not resend a queued letter that the old deployment already sent', async () => {
    const f = emailFixture()
    f.order.customer_confirmation_sent_at = new Date().toISOString()
    expect((await f.run()).map((job) => job?.status)).toEqual(['accepted','accepted'])
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0].body.to).toEqual(['seller@example.invalid'])
  })
  it.each([
    [429, 'rate_limit_exceeded', 'retry'], [503, 'application_error', 'retry'],
    [409, 'concurrent_idempotent_requests', 'retry'], [409, 'invalid_idempotent_request', 'needs_review'],
    [422, 'validation_error', 'needs_review'],
  ])('handles provider response %s/%s without claiming acceptance', async (status, name, expected) => {
    const f = emailFixture()
    f.fetchEmail.mockResolvedValueOnce(Response.json({ name }, { status: Number(status) }))
    expect(await processOrderEmail(f.services, 'test', f.order.id, 'customer')).toMatchObject({ status: expected })
    expect(f.order.customer_confirmation_sent_at).toBeNull()
  })

  it('does not claim acceptance for an incomplete success response', async () => {
    const f = emailFixture()
    f.fetchEmail.mockResolvedValueOnce(Response.json({}))
    expect(await processOrderEmail(f.services, 'test', f.order.id, 'customer')).toMatchObject({ status: 'retry' })
    expect(f.order.customer_confirmation_sent_at).toBeNull()
  })

  it('honors an early delivery event even if the HTTP send times out afterwards', async () => {
    const f = emailFixture()
    f.fetchEmail.mockImplementationOnce(async () => {
      f.jobs[0].resend_email_id = 'early-email-id'
      f.jobs[0].status = 'accepted'
      throw new Error('HTTP response interrupted')
    })
    expect(await processOrderEmail(f.services, 'test', f.order.id, 'customer')).toMatchObject({ status: 'accepted', resend_email_id: 'early-email-id' })
    expect(f.onError).not.toHaveBeenCalled()
  })

  it('delivers the seller notification despite a customer failure, and retries only the unfinished letter', async () => {
    const f = emailFixture()
    f.state.customerFailure = true
    const result = await f.run()
    expect(result.map((job) => job?.status)).toEqual(['retry','accepted'])
    expect(f.order.customer_confirmation_sent_at).toBeNull()
    expect(f.order.seller_notification_sent_at).toBeTruthy()
    expect(f.requests.map((request) => request.body.to[0]).sort()).toEqual(['customer@example.invalid','seller@example.invalid'])
    expect(f.requests[0].body.html).toContain('&lt;Test product&gt;')
    f.state.customerFailure = false
    f.makeDue()
    await f.run()
    expect(f.accepted.size).toBe(2)
    expect(f.requests.filter((request) => request.body.to[0] === 'seller@example.invalid')).toHaveLength(1)
    expect(f.order.customer_confirmation_sent_at).toBeTruthy()
  })

  it('sends the customer confirmation despite a seller failure', async () => {
    const f = emailFixture()
    f.state.sellerFailure = true
    expect((await f.run()).map((job) => job?.status)).toEqual(['accepted','retry'])
    expect(f.order.customer_confirmation_sent_at).toBeTruthy()
  })

  it.each(['lostResponse','acceptanceFailure'] as const)('recovers %s with the same immutable request even after shop edits', async (failure) => {
    const f = emailFixture()
    f.state[failure] = true
    await f.run()
    expect(f.accepted.size).toBe(2)
    f.store.name = 'New shop name'
    f.store.settings.contactEmail = 'new@example.invalid'
    f.order.customer_name = 'Edited customer'
    f.state[failure] = false
    f.makeDue()
    expect((await f.run()).map((job) => job?.status)).toEqual(['accepted','accepted'])
    expect(f.accepted.size).toBe(2)
    expect(f.requests[0].body).toEqual(f.requests[2].body)
    expect(f.requests[1].body).toEqual(f.requests[3].body)
    f.makeDue()
    await f.run()
    expect(f.requests).toHaveLength(4)
  })

  it('does not send twice during overlapping webhook and cron invocations', async () => {
    const f = emailFixture()
    await Promise.all([f.run(), f.run(), processOrderEmail(f.services, 'test')])
    expect(f.requests).toHaveLength(2)
  })

  it('respects disabled notifications without blocking the other recipient', async () => {
    const f = emailFixture()
    f.store.settings.customerConfirmations = false
    expect((await f.run()).map((job) => job?.status)).toEqual(['skipped','accepted'])
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0].body.to).toEqual(['seller@example.invalid'])
  })

  it('prefers the configured order address and falls back to the owner when necessary', async () => {
    const f = emailFixture()
    f.store.settings.orderNotificationEmail = 'orders@example.invalid'
    await f.run()
    expect(f.requests[1].body.to).toEqual(['orders@example.invalid'])
    const fallback = emailFixture()
    fallback.store.settings.contactEmail = ''
    await fallback.run()
    expect(fallback.requests.map((request) => request.body.to[0])).toContain('owner@example.invalid')
  })

  it('a failed owner lookup only blocks a letter that needs that address', async () => {
    const f = emailFixture()
    f.store.settings.contactEmail = ''
    f.state.ownerFailure = true
    expect((await f.run()).map((job) => job?.status)).toEqual(['accepted','retry'])
    expect(f.requests[0].body.reply_to).toBeUndefined()
  })

  it('does not send a new paid-order confirmation after a refund', async () => {
    const f = emailFixture()
    f.order.payment_status = 'refunded'
    expect((await f.run()).map((job) => job?.status)).toEqual(['skipped','skipped'])
    expect(f.requests).toHaveLength(0)
  })

  it('keeps an invalid customer address separate from the seller letter', async () => {
    const f = emailFixture()
    f.order.customer_email = 'invalid'
    expect((await f.run()).map((job) => job?.status)).toEqual(['needs_review','accepted'])
  })

  it('stops ambiguous sends before provider deduplication expires', async () => {
    vi.useFakeTimers()
    const f = emailFixture()
    f.state.lostResponse = true
    await f.run()
    vi.setSystemTime(Date.now() + 21 * 60 * 60 * 1000)
    f.state.lostResponse = false
    expect((await f.run()).map((job) => job?.status)).toEqual(['needs_review','needs_review'])
    expect(f.requests).toHaveLength(2)
  })

  it('waits for the stored retry time instead of hammering a failing provider', async () => {
    const f = emailFixture()
    f.state.customerFailure = true
    await f.run()
    await f.run()
    expect(f.requests).toHaveLength(2)
  })

  it('does not send after losing its lease and still attempts the other job', async () => {
    const f = emailFixture()
    f.state.leaseLost = true
    await expect(f.run()).rejects.toThrow('salvestamine')
    expect(f.rpc.mock.calls.filter(([name]) => name === 'claim_order_email_job')).toHaveLength(2)
    expect(f.requests).toHaveLength(0)
  })

  it('does not send while the rollout switch is disabled', async () => {
    vi.stubGlobal('Deno', { env: { get: () => 'false' } })
    const f = emailFixture()
    await f.run()
    expect(f.rpc).not.toHaveBeenCalled()
    expect(f.requests).toHaveLength(0)
  })
})

describe('signed order email event routing', () => {
  it.each(['object','array'])('uses order and recipient tags in %s form to record the event atomically', async (format) => {
    const f = emailFixture()
    const tags = { email_type: 'order_customer_confirmation', order_id: f.order.id, order_email_job_id: f.jobs[0].id }
    f.rpc.mockResolvedValueOnce({ data: true } as any)
    const handled = await recordOrderEmailEvent(f.admin, 'event-delivered', {
      type: 'email.delivered', created_at: '2026-09-09T14:00:00Z',
      data: { email_id: 'resend-1', to: [f.order.customer_email],
        tags: format === 'object' ? tags : Object.entries(tags).map(([name,value]) => ({ name,value })) },
    })
    expect(handled).toBe(true)
    expect(f.rpc).toHaveBeenCalledWith('record_order_email_delivery', expect.objectContaining({
      target_job_id: f.jobs[0].id, order_id_value: f.order.id, kind_value: 'customer', status_value: 'delivered', event_id_value: 'event-delivered',
    }))
  })

  it('leaves support and other mail with the existing handler', async () => {
    const f = emailFixture()
    expect(await recordOrderEmailEvent(f.admin, 'event-support', { type: 'email.delivered', data: { tags: { email_type: 'support_reply' } } })).toBe(false)
    expect(f.rpc).not.toHaveBeenCalled()
  })
})
