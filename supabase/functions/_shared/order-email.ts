import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

type JsonRecord = Record<string, unknown>

type OrderRow = {
  id: string
  store_id: string
  order_number: string
  items: unknown
  customer_name: string
  customer_email: string
  delivery: string
  product_subtotal: number | string
  total: number | string
  customer_confirmation_sent_at: string | null
  seller_notification_sent_at: string | null
}

type StoreRow = {
  id: string
  owner_id: string
  name: string
  settings: unknown
}

const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' ? value as JsonRecord : {}
const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')
const formatMoney = (value: unknown) => `${Number(value ?? 0).toFixed(2).replace('.', ',')} €`
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const safeColor = (value: unknown) => /^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? String(value) : '#e5f25a'
const safeImageUrl = (value: unknown) => {
  try {
    const url = new URL(String(value ?? ''))
    return url.protocol === 'https:' ? url.toString() : ''
  } catch { return '' }
}
const safeSenderName = (value: unknown) => String(value ?? '').replace(/[\r\n<>\"]/g, '').trim().slice(0, 70) || 'Pood'
const readableInk = (hex: string) => {
  const [red, green, blue] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => Number.parseInt(part, 16))
  return ((red * 299 + green * 587 + blue * 114) / 1000) > 150 ? '#171714' : '#ffffff'
}

const renderItems = (items: unknown) => (Array.isArray(items) ? items : []).map((itemValue) => {
  const item = asRecord(itemValue)
  const quantity = Math.max(1, Number(item.quantity ?? 1))
  const unitPrice = Number(item.salePrice ?? item.price ?? 0)
  const image = safeImageUrl(item.image ?? item.image_url)
  const options = Object.entries(asRecord(item.selectedOptions))
    .map(([name, value]) => `${escapeHtml(name)}: ${escapeHtml(value)}`)
    .join(' · ')
  return `<tr>
    <td style="width:58px;padding:14px 12px 14px 0;border-bottom:1px solid #e8e6e1">${image ? `<img src="${escapeHtml(image)}" width="52" height="52" alt="" style="display:block;width:52px;height:52px;border-radius:10px;object-fit:cover">` : '<div style="width:52px;height:52px;border-radius:10px;background:#f1efe9"></div>'}</td>
    <td style="padding:14px 0;border-bottom:1px solid #e8e6e1"><strong style="color:#23221f">${escapeHtml(item.name || 'Toode')}</strong>${options ? `<br><span style="color:#77736a;font-size:12px">${options}</span>` : ''}</td>
    <td style="padding:14px 10px;border-bottom:1px solid #e8e6e1;text-align:center;color:#77736a;white-space:nowrap">${quantity} ×</td>
    <td style="padding:14px 0;border-bottom:1px solid #e8e6e1;text-align:right;white-space:nowrap">${formatMoney(unitPrice * quantity)}</td>
  </tr>`
}).join('')

const renderTextItems = (items: unknown) => (Array.isArray(items) ? items : []).map((itemValue) => {
  const item = asRecord(itemValue)
  const quantity = Math.max(1, Number(item.quantity ?? 1))
  const unitPrice = Number(item.salePrice ?? item.price ?? 0)
  const options = Object.entries(asRecord(item.selectedOptions)).map(([name, value]) => `${name}: ${String(value)}`).join(', ')
  return `- ${String(item.name ?? 'Toode')} × ${quantity}${options ? ` (${options})` : ''}: ${formatMoney(unitPrice * quantity)}`
}).join('\n')

const emailShell = (input: { title: string; intro: string; order: OrderRow; store: StoreRow; settings: JsonRecord; seller?: boolean; canReply?: boolean }) => {
  const { title, intro, order, store, settings } = input
  const storeName = safeSenderName(settings.editableStoreName ?? store.name)
  const accent = safeColor(settings.storeAccent)
  const accentInk = readableInk(accent)
  const logo = safeImageUrl(settings.storeLogo)
  const contactEmail = String(settings.contactEmail ?? '').trim()
  const contactPhone = String(settings.contactPhone ?? '').trim()
  const businessName = String(settings.businessName ?? '').trim()
  const support = [contactEmail, contactPhone].filter(Boolean).join(' · ')
  const deliveryPrice = Math.max(0, Number(order.total) - Number(order.product_subtotal))
  return `<!doctype html>
<html lang="et"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1efe9;color:#23221f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(storeName)} · tellimus ${escapeHtml(order.order_number)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1efe9">
    <tr><td align="center" style="padding:40px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px">
        <tr><td style="padding:0 4px 20px">${logo
          ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(storeName)}" style="display:block;max-width:190px;max-height:64px;width:auto;height:auto">`
          : `<span style="font-size:21px;font-weight:800;letter-spacing:.08em;color:#171714">${escapeHtml(storeName)}</span>`}</td></tr>
        <tr><td style="overflow:hidden;border-radius:22px;background:#ffffff;box-shadow:0 10px 35px rgba(34,31,25,.08)">
          <div style="height:8px;background:${accent}"></div>
          <div style="padding:38px 38px 34px">
            <div style="margin-bottom:14px;color:#77736a;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">${input.seller ? 'Uus tellimus' : 'Tellimus kinnitatud'}</div>
            <h1 style="margin:0 0 14px;color:#171714;font-size:30px;line-height:1.2;letter-spacing:-.03em">${escapeHtml(title)}</h1>
            <p style="margin:0 0 28px;color:#56534d;font-size:16px;line-height:1.65">${escapeHtml(intro)}</p>
            <div style="margin-bottom:22px;padding:18px 20px;border-radius:14px;background:${accent};color:${accentInk}">
              <span style="display:block;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.7">Tellimuse number</span>
              <strong style="display:block;margin-top:5px;font-size:21px">${escapeHtml(order.order_number)}</strong>
            </div>
            ${input.seller ? `<div style="margin-bottom:22px;padding:18px 20px;border-radius:14px;background:#f6f4ef;color:#666159;font-size:14px;line-height:1.55"><strong style="color:#23221f">Klient</strong><br>${escapeHtml(order.customer_name)} · <a href="mailto:${escapeHtml(order.customer_email)}" style="color:#56534d">${escapeHtml(order.customer_email)}</a></div>` : ''}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px"><tbody>${renderItems(order.items)}</tbody></table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;font-size:14px;color:#666159">
              <tr><td style="padding:5px 0">Tooted</td><td style="padding:5px 0;text-align:right">${formatMoney(order.product_subtotal)}</td></tr>
              <tr><td style="padding:5px 0">Tarne</td><td style="padding:5px 0;text-align:right">${deliveryPrice > 0 ? formatMoney(deliveryPrice) : 'Tasuta'}</td></tr>
              <tr><td style="padding-top:14px;color:#171714;font-size:19px;font-weight:800">Kokku</td><td style="padding-top:14px;text-align:right;color:#171714;font-size:19px;font-weight:800">${formatMoney(order.total)}</td></tr>
            </table>
            <div style="margin-top:26px;padding:18px 20px;border-radius:14px;background:#f6f4ef;color:#666159;font-size:14px;line-height:1.55"><strong style="color:#23221f">Tarne</strong><br>${escapeHtml(order.delivery)}</div>
            ${!input.seller ? `<p style="margin:26px 0 0;color:#77736a;font-size:13px;line-height:1.6">Hakkame tellimust ette valmistama.${input.canReply ? ' Küsimuste korral vasta sellele kirjale.' : ''}</p>` : ''}
          </div>
        </td></tr>
        <tr><td style="padding:22px 4px 0;color:#8a857d;font-size:12px;line-height:1.6">${escapeHtml(businessName || storeName)}${support ? ` · ${escapeHtml(support)}` : ''}<br>Pood töötab <a href="https://poeruum.ee" style="color:#77736a;text-decoration:none">Poeruumil</a>.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

const sendEmail = async (input: { to: string; subject: string; html: string; text: string; fromName: string; replyTo?: string; idempotencyKey: string }) => {
  const apiKey = Deno.env.get('RESEND_API_KEY')?.trim()
  if (!apiKey) throw new Error('Puudub RESEND_API_KEY.')
  const configuredFrom = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'Poeruum <teavitused@send.poeruum.ee>'
  const senderAddress = configuredFrom.match(/<([^<>]+)>/)?.[1]?.trim() || configuredFrom
  const from = `${safeSenderName(input.fromName)} via Poeruum <${senderAddress}>`
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
  })
  if (!response.ok) throw new Error(`Resend vastas ${response.status}: ${await response.text()}`)
}

export const sendPaidOrderEmails = async (admin: SupabaseClient, orderId: string) => {
  const { data: orderData, error: orderError } = await admin.from('orders').select([
    'id', 'store_id', 'order_number', 'items', 'customer_name', 'customer_email', 'delivery',
    'product_subtotal', 'total', 'customer_confirmation_sent_at', 'seller_notification_sent_at',
  ].join(',')).eq('id', orderId).eq('payment_status', 'paid').maybeSingle()
  if (orderError) throw orderError
  if (!orderData) return
  const order = orderData as OrderRow

  const { data: storeData, error: storeError } = await admin.from('stores').select('id,owner_id,name,settings').eq('id', order.store_id).single()
  if (storeError) throw storeError
  const store = storeData as StoreRow
  const settings = asRecord(store.settings)
  const storeName = safeSenderName(settings.editableStoreName ?? store.name)
  const contactEmail = String(settings.contactEmail ?? '').trim().toLowerCase()
  let ownerEmail: string | null = null
  const getOwnerEmail = async () => {
    if (ownerEmail !== null) return ownerEmail
    const { data, error } = await admin.auth.admin.getUserById(store.owner_id)
    if (error) console.warn(`Poe ${store.id} omaniku e-posti laadimine ebaõnnestus.`, error)
    const candidate = data.user?.email?.trim().toLowerCase() ?? ''
    ownerEmail = isEmail(candidate) ? candidate : ''
    return ownerEmail
  }
  const customerReplyTo = isEmail(contactEmail) ? contactEmail : await getOwnerEmail()

  if (settings.customerConfirmations !== false && !order.customer_confirmation_sent_at) {
    await sendEmail({
      to: order.customer_email,
      fromName: storeName,
      replyTo: customerReplyTo || undefined,
      subject: `Tellimus ${order.order_number} on kinnitatud · ${storeName}`,
      html: emailShell({ title: 'Aitäh tellimuse eest!', intro: `Tere, ${order.customer_name}! Saime sinu tellimuse kätte ja makse õnnestus.`, order, store, settings, canReply: Boolean(customerReplyTo) }),
      text: `Aitäh tellimuse eest!\n\n${order.customer_name}, sinu tellimus poest ${storeName} on kinnitatud.\n\n${renderTextItems(order.items)}\n\nTarne: ${order.delivery}\nKokku: ${formatMoney(order.total)}\nTellimus: ${order.order_number}${customerReplyTo ? `\n\nKüsimuste korral vasta sellele kirjale (${customerReplyTo}).` : ''}`,
      idempotencyKey: `order-${order.id}-customer-confirmation`,
    })
    const { error } = await admin.from('orders').update({ customer_confirmation_sent_at: new Date().toISOString() }).eq('id', order.id).is('customer_confirmation_sent_at', null)
    if (error) throw error
  }

  if (settings.sellerNotifications !== false && !order.seller_notification_sent_at) {
    let sellerEmail = String(settings.orderNotificationEmail ?? '').trim().toLowerCase()
    if (!isEmail(sellerEmail)) sellerEmail = contactEmail
    if (!isEmail(sellerEmail)) sellerEmail = await getOwnerEmail()
    if (isEmail(sellerEmail)) {
      await sendEmail({
        to: sellerEmail,
        fromName: storeName,
        replyTo: isEmail(order.customer_email) ? order.customer_email : undefined,
        subject: `Uus tellimus ${order.order_number} · ${formatMoney(order.total)} · ${storeName}`,
        html: emailShell({ title: 'Uus tasutud tellimus', intro: `${order.customer_name} esitas ja tasus uue tellimuse.`, order, store, settings, seller: true }),
        text: `Uus tasutud tellimus\n\nKlient: ${order.customer_name}\nE-post: ${order.customer_email}\n\n${renderTextItems(order.items)}\n\nTarne: ${order.delivery}\nKokku: ${formatMoney(order.total)}\nTellimus: ${order.order_number}`,
        idempotencyKey: `order-${order.id}-seller-notification`,
      })
      const { error } = await admin.from('orders').update({ seller_notification_sent_at: new Date().toISOString() }).eq('id', order.id).is('seller_notification_sent_at', null)
      if (error) throw error
    } else {
      console.warn(`Tellimuse ${order.order_number} müüja e-posti aadress puudub.`)
    }
  }
}
