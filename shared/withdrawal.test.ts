import { describe, expect, it } from 'vitest'
import { parseWithdrawal, withdrawalStatement, withdrawalTime } from './withdrawal'
const input = { requestId: '82000000-0000-4000-8000-000000000004', customerName: ' Ostja ', customerEmail: ' BUYER@example.invalid ', orderReference: ' PR-1 ', scope: '' }
describe('withdrawal declarations', () => {
  it('accepts a declaration without a reason and normalizes its contact', () => {
    expect(parseWithdrawal(input)).toEqual({ ...input, customerName: 'Ostja', customerEmail: 'buyer@example.invalid', orderReference: 'PR-1' })
    expect(withdrawalStatement({ orderReference: 'PR-1', scope: '' })).toContain('kogu tellimust')
    expect(withdrawalStatement({ orderReference: 'PR-1', scope: 'Sinine kruus, 1 tk' })).toContain('Sinine kruus, 1 tk')
  })
  it('rejects invalid, oversized and header-injection fields', () => {
    for (const change of [{ customerName: '' }, { customerEmail: 'bad' }, { customerName: 'Name\nBcc:x@example.invalid' }, { scope: 'x'.repeat(2001) }, { requestId: 'order-id' }, { orderReference: 'x'.repeat(121) }]) expect(parseWithdrawal({ ...input, ...change })).toBeNull()
    expect(parseWithdrawal(null)).toBeNull()
  })
  it('uses Estonia time regardless of the worker or browser timezone', () => {
    expect(withdrawalTime('2026-10-11T12:00:00Z')).toContain('15:00')
  })
})
