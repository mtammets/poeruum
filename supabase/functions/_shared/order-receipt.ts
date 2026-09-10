import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type Stripe from 'npm:stripe@^22'
import type { OrderReceipt, ReceiptAccess, ReceiptStatus } from '../../../shared/order-receipt.ts'
import { confirmPaidStoreOrder } from './store-payment.ts'
import type { StripeMode } from './stripe-mode.ts'

const orderColumns = 'id,store_id,order_number,items,delivery,product_subtotal,total,created_at,payment_status,stripe_mode,stripe_checkout_session_id,stripe_payment_intent_id,stripe_failure_verified_at'
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}

export const parseReceiptAccess = (value: unknown): ReceiptAccess | null => {
  const body = record(value)
  if (typeof body.token === 'string' && /^[0-9a-f]{64}$/.test(body.token) && !body.sessionId) return { token: body.token }
  // Compatibility with checkout sessions created before receipt tokens existed.
  // Their random Stripe session ID is also a bearer credential, not an order ID.
  if (typeof body.sessionId === 'string' && /^cs_(test|live)_[a-zA-Z0-9]{24,200}$/.test(body.sessionId) && !body.token) return { sessionId: body.sessionId }
  return null
}

export const safeCheckoutUrl = (value: unknown): string | null => {
  try {
    const url = new URL(String(value))
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export const loadOrderReceipt = async (
  services: { admin: SupabaseClient; stripe: Stripe; mode: StripeMode }, access: ReceiptAccess,
): Promise<OrderReceipt | null> => {
  const { admin, stripe, mode } = services
  let lookup: { column: string; value: string }
  if ('token' in access) {
    const { data, error } = await admin.from('order_receipt_access').select('order_id').eq('token', access.token).maybeSingle()
    if (error) throw error
    if (!data) return null
    lookup = { column: 'id', value: data.order_id }
  } else lookup = { column: 'stripe_checkout_session_id', value: access.sessionId }

  const readOrder = async () => {
    const { data, error } = await admin.from('orders').select(orderColumns).eq(lookup.column, lookup.value).maybeSingle()
    if (error) throw error
    return data
  }
  let order = await readOrder()
  if (!order || order.stripe_mode !== mode) return null
  let status: ReceiptStatus = order.payment_status === 'paid' ? 'paid' : order.payment_status === 'refunded' ? 'refunded' : 'pending'
  if (order.payment_status === 'failed' && !order.stripe_checkout_session_id && order.stripe_failure_verified_at) status = 'failed'
  let resumeUrl: string | null = null
  if (status === 'pending' && order.stripe_checkout_session_id) {
    const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id, { expand: ['payment_intent'] })
    const pi = session.payment_intent && typeof session.payment_intent === 'object' ? session.payment_intent : null
    const piId = typeof session.payment_intent === 'string' ? session.payment_intent : pi?.id
    if (session.id !== order.stripe_checkout_session_id || session.mode !== 'payment' || session.livemode !== (mode === 'live')
      || session.metadata?.order_id !== order.id || session.metadata?.store_id !== order.store_id
      || session.client_reference_id !== order.store_id || session.currency !== 'eur'
      || session.amount_total !== Math.round(Number(order.total) * 100)
      || (order.stripe_payment_intent_id && order.stripe_payment_intent_id !== piId)) {
      throw new Error('Tellimuse ja makse andmed ei ühti.')
    }
    if (session.payment_status === 'paid') {
      if (session.status !== 'complete' || !piId) throw new Error('Kinnitatud makse andmed on puudulikud.')
      // Only confirm the validated payment here. The same atomic RPC persists
      // email/settlement jobs; this request never sends mail or moves money.
      await confirmPaidStoreOrder({ admin, stripe }, {
        orderId: order.id, storeId: order.store_id, sessionId: session.id, paymentIntentId: piId, mode,
      })
      order = await readOrder()
      if (!order) return null
      status = order.payment_status === 'refunded' ? 'refunded' : order.payment_status === 'paid' ? 'paid' : 'pending'
    } else if (pi && (['processing', 'succeeded', 'requires_capture'].includes(pi.status)
      || (session.status !== 'open' && ['requires_action', 'requires_confirmation'].includes(pi.status)))) {
      status = 'pending'
    } else if ((session.status === 'complete' && pi?.status === 'canceled') || session.status === 'expired') {
      status = 'expired'
    } else if (session.status === 'complete' && pi?.status === 'requires_payment_method' && pi.last_payment_error) {
      status = 'failed'
    } else if (session.status === 'complete') {
      status = 'pending'
    } else if (session.status === 'open') {
      status = pi?.status === 'requires_payment_method' && pi.last_payment_error ? 'failed' : 'unpaid'
      resumeUrl = safeCheckoutUrl(session.url)
    }
    // A webhook may have completed payment/refund while the Stripe read ran.
    const latest = await readOrder()
    if (!latest) return null
    order = latest
    if (order.payment_status === 'paid' || order.payment_status === 'refunded') {
      status = order.payment_status
      resumeUrl = null
    }
  }
  const { data: store, error: storeError } = await admin.from('stores').select('name').eq('id', order.store_id).maybeSingle()
  if (storeError) throw storeError
  return {
    status, orderNumber: order.order_number, storeName: store?.name || 'E-pood', createdAt: order.created_at,
    currency: 'eur', total: Number(order.total), deliveryTotal: Math.max(0, Math.round((Number(order.total) - Number(order.product_subtotal)) * 100) / 100),
    delivery: String(order.delivery ?? ''),
    items: (Array.isArray(order.items) ? order.items : []).map((value: unknown) => {
      const item = record(value)
      const regular = Number(item.price ?? 0)
      const sale = item.salePrice == null ? regular : Number(item.salePrice)
      return { name: String(item.name ?? ''), quantity: Number(item.quantity ?? 1), unitPrice: Math.min(regular, sale),
        options: Object.fromEntries(Object.entries(record(item.selectedOptions)).map(([key, value]) => [key, String(value)])) }
    }),
    resumeUrl,
  }
}
