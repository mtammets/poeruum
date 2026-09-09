import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type Stripe from 'npm:stripe@^22'
import { processStoreSettlement, type SettlementJob } from './order-settlement.ts'

// The worker is exercised against stateful Stripe responses. Actual SQL lease,
// transaction and access boundaries are covered by test-order-settlements.sql.
const fixture = () => {
  const order = {
    id: 'order-1', store_id: 'store-1', order_number: 'PR-TEST', total: 27.32,
    payment_status: 'paid', stripe_mode: 'test', stripe_payment_intent_id: 'pi_1',
    stripe_transfer_id: null as string | null, stripe_refund_id: null as string | null,
  }
  const job = {
    order_id: order.id, stripe_mode: 'test', status: 'pending', lease_token: 'token',
    lease_expires_at: new Date(Date.now() + 300_000).toISOString(),
    transfer_payload: null, settlement_data: null, transfer_started_at: null,
    refund_requested_at: null, refund_payload: null, refund_started_at: null, stripe_refund_id: null,
  } as SettlementJob
  const charge: any = { id: 'ch_1', status: 'succeeded', paid: true, captured: true, refunded: false,
    amount_refunded: 0, balance_transaction: { id: 'txn_1', fee: 66 } }
  const payment: any = {
    id: 'pi_1', status: 'succeeded', currency: 'eur', livemode: false, amount_received: 2732,
    latest_charge: charge, metadata: { order_id: order.id, store_id: order.store_id,
      seller_account_id: 'acct_1', platform_fee_cents: '122', platform_fee_net_cents: '98', platform_fee_vat_cents: '24' },
  }
  const state = { leased: false, leaseLost: false, lostTransferResponse: false, lostRefundResponse: false,
    recordFailure: false, refundOnPrepare: false, refundOnTransfer: false, refundPending: false }
  const transfers: any[] = []
  const refunds: any[] = []
  const operations: string[] = []
  const iterate = async function* (rows: any[]) { for (const row of rows) yield structuredClone(row) }
  const rpc = vi.fn(async (name: string, args: any) => {
    if (name === 'claim_stripe_order_settlement') {
      if (state.leased || ['completed', 'refunded', 'needs_review'].includes(job.status)) return { data: [], error: null }
      state.leased = true
      return { data: [structuredClone(job)], error: null }
    }
    if (state.leaseLost) return { data: null, error: new Error('SETTLEMENT_LEASE_LOST') }
    if (name === 'prepare_stripe_order_operation') {
      const op = args.operation_value as 'transfer' | 'refund'
      if (op === 'transfer' && state.refundOnPrepare) job.refund_requested_at = new Date().toISOString()
      if (!(op === 'transfer' && job.refund_requested_at) && !job[`${op}_payload`]) {
        Object.assign(job, { [`${op}_payload`]: args.payload_value, [`${op}_started_at`]: new Date().toISOString() })
        if (op === 'transfer') job.settlement_data = args.settlement_value
      }
    } else if (name === 'record_stripe_order_transfer') {
      if (state.recordFailure) return { error: new Error('Database unavailable') }
      order.stripe_transfer_id = args.transfer_id_value
    } else if (name === 'finish_stripe_order_settlement') {
      job.status = args.outcome_value === 'completed' && job.refund_requested_at ? 'retry' : args.outcome_value
      job.stripe_refund_id = args.refund_id_value ?? job.stripe_refund_id
      if (job.status === 'refunded') order.payment_status = 'refunded'
      state.leased = false
    }
    return { data: structuredClone(job), error: null }
  })
  const from = (table: string) => {
    const query = { select: () => query, eq: () => query,
      single: async () => ({ data: structuredClone(table === 'orders' ? order : { stripe_account_id: 'acct_1' }), error: null }) }
    return query
  }
  const stripe = {
    paymentIntents: { retrieve: vi.fn(async () => structuredClone(payment)) },
    charges: { retrieve: vi.fn(async () => structuredClone(charge)) },
    balanceTransactions: { retrieve: vi.fn(async () => ({ fee: 66 })) },
    transfers: {
      list: vi.fn(() => iterate(transfers)),
      retrieve: vi.fn(async (id: string) => structuredClone(transfers.find((tr) => tr.id === id))),
      create: vi.fn(async (payload: any) => {
        expect(job.transfer_payload).toEqual(payload)
        operations.push('transfer')
        const transfer = { id: 'tr_1', ...payload, reversed: false, amount_reversed: 0 }
        transfers.push(transfer)
        if (state.refundOnTransfer) job.refund_requested_at = new Date().toISOString()
        if (state.lostTransferResponse) throw new Error('Connection interrupted')
        return structuredClone(transfer)
      }),
      createReversal: vi.fn(async (id: string) => {
        operations.push('reversal')
        const transfer = transfers.find((tr) => tr.id === id)
        transfer.reversed = true
        transfer.amount_reversed = transfer.amount
        return { id: 'trr_1' }
      }),
    },
    refunds: {
      list: vi.fn(() => iterate(refunds)),
      retrieve: vi.fn(async (id: string) => structuredClone(refunds.find((re) => re.id === id))),
      create: vi.fn(async (payload: any) => {
        expect(job.refund_payload).toEqual(payload)
        operations.push('refund')
        const refund = { id: 're_1', payment_intent: 'pi_1', amount: 2732, status: state.refundPending ? 'pending' : 'succeeded' }
        refunds.push(refund)
        if (state.lostRefundResponse) throw new Error('Connection interrupted')
        return structuredClone(refund)
      }),
    },
  }
  const onError = vi.fn(async () => {})
  const services = { admin: { from, rpc } as unknown as SupabaseClient, stripe: stripe as unknown as Stripe, onError }
  const run = () => processStoreSettlement(services, 'test', order.id)
  const requestRefund = () => { job.refund_requested_at = new Date().toISOString(); job.status = 'pending' }
  return { job, order, state, payment, charge, stripe, rpc, transfers, refunds, operations, onError, run, requestRefund }
}

afterEach(() => vi.useRealTimers())

describe('durable order settlement', () => {
  it('waits 76 seconds for fees without an error, then settles once across competing executions', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.charge.balance_transaction = null
    expect(await f.run()).toMatchObject({ status: 'waiting_for_fee' })
    expect(f.order.payment_status).toBe('paid')
    expect(f.operations).toEqual([])
    expect(f.onError).not.toHaveBeenCalled()
    vi.setSystemTime(Date.now() + 76_000)
    f.charge.balance_transaction = { fee: 66 }
    const results = await Promise.all([f.run(), f.run()])
    expect(results).toContain(null)
    expect(results).toContainEqual(expect.objectContaining({ status: 'completed' }))
    expect(await f.run()).toBeNull()
    expect(f.stripe.transfers.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      amount: 2544, destination: 'acct_1', source_transaction: 'ch_1', currency: 'eur',
    }), { idempotencyKey: 'poeruum-order-transfer-order-1' })
    expect(f.job.settlement_data).toEqual({ processing_fee_cents: 66, platform_fee_net_cents: 98, platform_fee_vat_cents: 24, seller_net_cents: 2544 })
  })

  it.each(['lostTransferResponse', 'recordFailure'] as const)('recovers a transfer after %s without another Stripe POST', async (failure) => {
    const f = fixture()
    f.state[failure] = true
    expect(await f.run()).toMatchObject({ status: 'retry' })
    f.state[failure] = false
    expect(await f.run()).toMatchObject({ status: 'completed' })
    expect(f.operations).toEqual(['transfer'])
    expect(f.order.stripe_transfer_id).toBe('tr_1')
  })

  it('replays the saved payload and key if Stripe never accepted the transfer', async () => {
    const f = fixture()
    f.stripe.transfers.create.mockRejectedValueOnce(new Error('Unavailable'))
    expect(await f.run()).toMatchObject({ status: 'retry' })
    const payload = structuredClone(f.job.transfer_payload)
    f.payment.metadata.platform_fee_cents = '999'
    expect(await f.run()).toMatchObject({ status: 'completed' })
    expect(f.stripe.transfers.create.mock.calls[1]).toEqual([payload, { idempotencyKey: 'poeruum-order-transfer-order-1' }])
  })

  it.each(['before fees', 'during preparation'])('refunds %s without creating a seller transfer', async (timing) => {
    const f = fixture()
    if (timing === 'before fees') { f.charge.balance_transaction = null; f.requestRefund() }
    else f.state.refundOnPrepare = true
    expect(await f.run()).toMatchObject({ status: 'refunded' })
    expect(f.operations).toEqual(['refund'])
    expect(f.stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: 'pi_1' }),
      { idempotencyKey: 'poeruum-order-refund-order-1' })
  })

  it('resolves an ambiguous transfer before reversing and refunding it', async () => {
    const f = fixture()
    f.state.lostTransferResponse = true
    await f.run()
    f.requestRefund()
    expect(await f.run()).toMatchObject({ status: 'refunded' })
    expect(f.operations).toEqual(['transfer', 'reversal', 'refund'])
    expect(await f.run()).toBeNull()
  })

  it('requeues a refund that arrives while a transfer is being sent', async () => {
    const f = fixture()
    f.state.refundOnTransfer = true
    expect(await f.run()).toMatchObject({ status: 'retry' })
    expect(await f.run()).toMatchObject({ status: 'refunded' })
    expect(f.operations).toEqual(['transfer', 'reversal', 'refund'])
  })

  it('keeps a pending refund paid until Stripe confirms it, without resending it', async () => {
    const f = fixture()
    f.state.refundPending = true
    f.requestRefund()
    expect(await f.run()).toMatchObject({ status: 'refund_pending', refundId: 're_1' })
    expect(f.order.payment_status).toBe('paid')
    f.refunds[0].status = 'succeeded'
    expect(await f.run()).toMatchObject({ status: 'refunded' })
    expect(f.order.payment_status).toBe('refunded')
    expect(f.operations).toEqual(['refund'])
  })

  it('recovers a refund whose response was lost without refunding twice', async () => {
    const f = fixture()
    f.state.lostRefundResponse = true
    f.requestRefund()
    expect(await f.run()).toMatchObject({ status: 'retry' })
    expect(await f.run()).toMatchObject({ status: 'refunded' })
    expect(f.operations).toEqual(['refund'])
  })

  it.each(['partial', 'multiple', 'failed'])('stops on %s refunds before reversing seller money', async (kind) => {
    const f = fixture()
    await f.run()
    f.requestRefund()
    f.refunds.push({ id: 're_other', payment_intent: 'pi_1', amount: kind === 'partial' ? 100 : 2732,
      status: kind === 'failed' ? 'failed' : 'succeeded' })
    if (kind === 'multiple') f.refunds.push({ ...f.refunds[0], id: 're_extra' })
    expect(await f.run()).toMatchObject({ status: 'needs_review' })
    expect(f.operations).toEqual(['transfer'])
    expect(f.onError).toHaveBeenCalled()
  })

  it.each(['transfer', 'refund'] as const)('does not replay an unresolved %s beyond the retention safety window', async (operation) => {
    vi.useFakeTimers()
    const f = fixture()
    if (operation === 'refund') f.requestRefund()
    f.stripe[operation === 'transfer' ? 'transfers' : 'refunds'].create.mockRejectedValueOnce(new Error('Unknown result'))
    expect(await f.run()).toMatchObject({ status: 'retry' })
    vi.setSystemTime(Date.now() + 21 * 60 * 60 * 1000)
    expect(await f.run()).toMatchObject({ status: 'needs_review' })
    expect(f.stripe[operation === 'transfer' ? 'transfers' : 'refunds'].create).toHaveBeenCalledTimes(1)
  })

  it('can reconcile an existing transfer after the replay window expires', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.state.lostTransferResponse = true
    await f.run()
    vi.setSystemTime(Date.now() + 30 * 60 * 60 * 1000)
    expect(await f.run()).toMatchObject({ status: 'completed' })
    expect(f.operations).toEqual(['transfer'])
  })

  it.each(['amount_received', 'currency', 'livemode', 'metadata'])('makes no transfer if payment %s mismatches', async (key) => {
    const f = fixture()
    f.payment[key] = { amount_received: 100, currency: 'usd', livemode: true, metadata: {} }[key]
    expect(await f.run()).toMatchObject({ status: 'needs_review' })
    expect(f.operations).toEqual([])
  })

  it('does not POST after losing its lease and propagates the failed state write', async () => {
    const f = fixture()
    f.state.leaseLost = true
    await expect(f.run()).rejects.toThrow('SETTLEMENT_LEASE_LOST')
    expect(f.operations).toEqual([])
  })
})
