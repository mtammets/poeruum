import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { buildOrderDocumentEmail } from './order-document-email.ts'

import { asRecord, formatMoney, isEmail, safeSenderName, renderTextItems, emailShell, type OrderRow, type StoreRow } from './order-email-template.ts'

export type OrderEmailKind = 'customer' | 'seller' | 'customer_credit' | 'seller_credit'
export type OrderEmailPayload = {
  from: string
  to: string[]
  subject: string
  html: string
  text: string
  attachments?: Array<{ filename: string; content: string; content_type: string }>
  reply_to?: string
  tags: { name: string; value: string }[]
}
export class OrderEmailInputError extends Error {}

// Build each recipient independently. The queue saves this exact payload before
// sending so edits to the shop cannot alter an ambiguous request on retry.
export const buildPaidOrderEmail = async (admin: SupabaseClient, orderId: string, kind: OrderEmailKind, jobId: string): Promise<OrderEmailPayload | null> => {
  const { data: orderData, error: orderError } = await admin.from('orders').select([
    'invoice_snapshot', 'payment_status', 'id', 'store_id', 'order_number', 'items', 'customer_name', 'customer_email', 'delivery',
    'product_subtotal', 'total', 'seller_vat_registered', 'seller_vat_number', 'seller_vat_rate',
    'seller_vat_amount', 'customer_confirmation_sent_at', 'seller_notification_sent_at',
  ].join(',')).eq('id', orderId).maybeSingle()
  if (orderError) throw orderError
  if (!orderData) return null
  const payment = orderData as unknown as { invoice_snapshot?: unknown; payment_status: string }
  if (payment.invoice_snapshot && ['paid','refunded'].includes(payment.payment_status)) {
    if (kind.endsWith('_credit') && payment.payment_status !== 'refunded') return null
    return buildOrderDocumentEmail(admin, orderId, kind, jobId, payment.payment_status === 'refunded')
  }
  if (payment.payment_status !== 'paid' || kind.endsWith('_credit')) return null
  const order = orderData as unknown as OrderRow
  const { data: storeData, error: storeError } = await admin.from('stores').select('id,owner_id,name,settings').eq('id', order.store_id).single()
  if (storeError) throw storeError
  const store = storeData as StoreRow
  const settings = asRecord(store.settings)
  if ((kind === 'customer' ? settings.customerConfirmations : settings.sellerNotifications) === false) return null
  const storeName = safeSenderName(settings.editableStoreName ?? store.name)
  const contactEmail = String(settings.contactEmail ?? '').trim().toLowerCase()
  const getOwnerEmail = async () => {
    const { data, error } = await admin.auth.admin.getUserById(store.owner_id)
    if (error) throw error
    return data.user?.email?.trim().toLowerCase() ?? ''
  }
  let recipient: string
  let replyTo: string | undefined
  if (kind === 'customer') {
    recipient = order.customer_email.trim()
    // A missing optional reply address must not block the customer's receipt.
    const candidate = isEmail(contactEmail) ? contactEmail : await getOwnerEmail().catch(() => '')
    replyTo = isEmail(candidate) ? candidate : undefined
  } else {
    recipient = String(settings.orderNotificationEmail ?? '').trim().toLowerCase()
    if (!isEmail(recipient)) recipient = contactEmail
    if (!isEmail(recipient)) recipient = await getOwnerEmail()
    replyTo = isEmail(order.customer_email) ? order.customer_email : undefined
  }
  if (!isEmail(recipient)) throw new OrderEmailInputError('Tellimuse kirja saaja e-posti aadress puudub või on vigane.')
  const configuredFrom = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'Poeruum <teavitused@send.poeruum.ee>'
  const senderAddress = configuredFrom.match(/<([^<>]+)>/)?.[1]?.trim() || configuredFrom
  const common = {
    from: `${storeName} via Poeruum <${senderAddress}>`, to: [recipient],
    ...(replyTo ? { reply_to: replyTo } : {}),
    tags: [
      { name: 'email_type', value: kind === 'customer' ? 'order_customer_confirmation' : 'order_seller_notification' },
      { name: 'order_id', value: order.id }, { name: 'order_email_job_id', value: jobId },
    ],
  }
  if (kind === 'customer') return {
    ...common,
    subject: `Tellimus ${order.order_number} on kinnitatud · ${storeName}`,
    html: emailShell({ title: 'Aitäh tellimuse eest!', intro: `Tere, ${order.customer_name}! Saime sinu tellimuse kätte ja makse õnnestus.`, order, store, settings, canReply: Boolean(replyTo) }),
    text: `Aitäh tellimuse eest!\n\n${order.customer_name}, sinu tellimus poest ${storeName} on kinnitatud.\n\n${renderTextItems(order.items)}\n\nTarne: ${order.delivery}\n${order.seller_vat_registered ? `Käibemaks ${order.seller_vat_rate}%: ${formatMoney(order.seller_vat_amount)}\n` : 'Müüja ei ole käibemaksukohustuslane.\n'}Kokku: ${formatMoney(order.total)}\nTellimus: ${order.order_number}${replyTo ? `\n\nKüsimuste korral vasta sellele kirjale (${replyTo}).` : ''}`,
  }
  return {
    ...common,
    subject: `Uus tellimus ${order.order_number} · ${formatMoney(order.total)} · ${storeName}`,
    html: emailShell({ title: 'Uus tasutud tellimus', intro: `${order.customer_name} esitas ja tasus uue tellimuse.`, order, store, settings, seller: true }),
    text: `Uus tasutud tellimus\n\nKlient: ${order.customer_name}\nE-post: ${order.customer_email}\n\n${renderTextItems(order.items)}\n\nTarne: ${order.delivery}\n${order.seller_vat_registered ? `Käibemaks ${order.seller_vat_rate}%: ${formatMoney(order.seller_vat_amount)}\n` : 'Müüja ei ole käibemaksukohustuslane.\n'}Kokku: ${formatMoney(order.total)}\nTellimus: ${order.order_number}`,
  }
}
