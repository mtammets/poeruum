import { requireSupabase } from './supabase'
import type { OrderReceipt, ReceiptAccess } from '../../shared/order-receipt'

export type ReceiptLocation = { access: ReceiptAccess | null; storePath: string }
export const readReceiptLocation = (href: string): ReceiptLocation | null => {
  const url = new URL(href)
  if (!url.searchParams.has('checkout')) return null
  const hash = new URLSearchParams(url.hash.slice(1))
  const token = hash.get('receipt')
  const sessionId = hash.get('session_id') || url.searchParams.get('session_id')
  const access = token && /^[0-9a-f]{64}$/.test(token) ? { token }
    : sessionId && /^cs_(test|live)_[a-zA-Z0-9]{24,200}$/.test(sessionId) ? { sessionId } : null
  return { access, storePath: url.pathname.replace(/^\/+/, '/') }
}

export class ReceiptLoadError extends Error {
  constructor(message: string, public retryable = true) { super(message) }
}

export const fetchOrderReceipt = async (access: ReceiptAccess, signal: AbortSignal): Promise<OrderReceipt> => {
  const { data, error } = await requireSupabase().functions.invoke('order-receipt', {
    body: access, signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  })
  if (error) {
    const response = 'context' in error && error.context instanceof Response ? error.context : null
    const details = await response?.clone().json().catch(() => null)
    throw new ReceiptLoadError(details?.error || 'Tellimuse olekut ei õnnestunud kontrollida. Proovi uuesti.', !response || ![400, 404].includes(response.status))
  }
  const receipt = data?.receipt as OrderReceipt | undefined
  if (!receipt || !['pending', 'unpaid', 'paid', 'failed', 'expired', 'refunded'].includes(receipt.status)
    || typeof receipt.orderNumber !== 'string' || typeof receipt.storeName !== 'string'
    || receipt.currency !== 'eur' || !Number.isFinite(receipt.total) || !Number.isFinite(receipt.deliveryTotal)
    || typeof receipt.delivery !== 'string' || typeof receipt.createdAt !== 'string' || !Number.isFinite(Date.parse(receipt.createdAt)) || !Array.isArray(receipt.items)
    || receipt.items.some((item) => !item || typeof item.name !== 'string' || !Number.isFinite(item.unitPrice)
      || !Number.isInteger(item.quantity) || item.quantity < 1 || !item.options || typeof item.options !== 'object'
      || Object.values(item.options).some((value) => typeof value !== 'string'))) {
    throw new ReceiptLoadError('Tellimuse vastus oli puudulik. Proovi uuesti.')
  }
  if (receipt.resumeUrl) {
    try {
      const url = new URL(receipt.resumeUrl)
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password) receipt.resumeUrl = null
    } catch { receipt.resumeUrl = null }
  }
  return receipt
}
