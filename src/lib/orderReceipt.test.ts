import { describe, expect, it, vi } from 'vitest'
const invoke = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ requireSupabase: () => ({ functions: { invoke } }) }))
import { fetchOrderReceipt, readReceiptLocation } from './orderReceipt'

describe('receipt links and server responses', () => {
  it('does not infer payment or order access from a success flag or order number', () => {
    expect(readReceiptLocation('https://shop.example.invalid/?checkout=success&order=PR-1')?.access).toBeNull()
    expect(readReceiptLocation('https://shop.example.invalid/')).toBeNull()
  })
  it('reads private fragments on a subdomain or path and supports legacy session links', () => {
    const token = 'a'.repeat(64)
    expect(readReceiptLocation(`https://shop.example.invalid/?checkout=status#receipt=${token}`)).toEqual({ access: { token }, storePath: '/' })
    const sessionId = 'cs_test_' + 'b'.repeat(40)
    expect(readReceiptLocation(`https://poeruum.ee/p/shop?checkout=success&session_id=${sessionId}`)).toEqual({ access: { sessionId }, storePath: '/p/shop' })
    expect(readReceiptLocation(`https://poeruum.ee//evil.invalid/?checkout=status#receipt=${token}`)?.storePath).toBe('/evil.invalid/')
  })
  it('rejects malformed success responses rather than rendering a payment confirmation', async () => {
    for (const data of [{ success: true }, { receipt: { status: 'paid' } }]) {
      invoke.mockResolvedValueOnce({ data, error: null })
      await expect(fetchOrderReceipt({ token: 'a'.repeat(64) }, new AbortController().signal)).rejects.toThrow('puudulik')
    }
  })
  it('treats unknown credentials as permanent and server failures as retryable', async () => {
    for (const status of [404, 503]) {
      invoke.mockResolvedValueOnce({ error: { context: Response.json({ error: 'Lookup failed' }, { status }) } })
      await expect(fetchOrderReceipt({ token: 'a'.repeat(64) }, new AbortController().signal)).rejects.toMatchObject({ message: 'Lookup failed', retryable: status === 503 })
    }
  })
})
