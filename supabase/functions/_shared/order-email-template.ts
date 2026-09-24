type JsonRecord = Record<string, unknown>

export type OrderRow = {
  id: string
  store_id: string
  order_number: string
  items: unknown
  customer_name: string
  customer_email: string
  delivery: string
  product_subtotal: number | string
  total: number | string
  seller_vat_registered: boolean
  seller_vat_number: string | null
  seller_vat_rate: number | string | null
  seller_vat_amount: number | string
  customer_confirmation_sent_at: string | null
  seller_notification_sent_at: string | null
}

export type StoreRow = {
  id: string
  owner_id: string
  name: string
  settings: unknown
}

export const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' ? value as JsonRecord : {}
const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')
export const formatMoney = (value: unknown) => `${Number(value ?? 0).toFixed(2).replace('.', ',')} €`
export const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const safeColor = (value: unknown) => /^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? String(value) : '#e5f25a'
const safeImageUrl = (value: unknown) => {
  try {
    const url = new URL(String(value ?? ''))
    return url.protocol === 'https:' ? url.toString() : ''
  } catch { return '' }
}
export const safeSenderName = (value: unknown) => String(value ?? '').replace(/[\r\n<>"]/g, '').trim().slice(0, 70) || 'Pood'
const readableInk = (hex: string) => {
  const [red, green, blue] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => Number.parseInt(part, 16))
  return ((red * 299 + green * 587 + blue * 114) / 1000) > 150 ? '#171714' : '#ffffff'
}

const renderItems = (items: unknown) => (Array.isArray(items) ? items : []).map((itemValue) => {
  const item = asRecord(itemValue)
  const quantity = Math.max(1, Number(item.quantity ?? 1))
  const unitPrice = Number(item.salePrice ?? item.price ?? 0)
  const originalImage = String(item.image ?? item.image_url ?? '')
  const imageAsset = asRecord(asRecord(item.imageVariants)[originalImage])
  const thumbnail = asRecord(asRecord(imageAsset.variants).thumb).url
  const image = safeImageUrl(thumbnail ?? originalImage)
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

export const renderTextItems = (items: unknown) => (Array.isArray(items) ? items : []).map((itemValue) => {
  const item = asRecord(itemValue)
  const quantity = Math.max(1, Number(item.quantity ?? 1))
  const unitPrice = Number(item.salePrice ?? item.price ?? 0)
  const options = Object.entries(asRecord(item.selectedOptions)).map(([name, value]) => `${name}: ${String(value)}`).join(', ')
  return `- ${String(item.name ?? 'Toode')} × ${quantity}${options ? ` (${options})` : ''}: ${formatMoney(unitPrice * quantity)}`
}).join('\n')

export const emailShell = (input: { title: string; intro: string; order: OrderRow; store: StoreRow; settings: JsonRecord; seller?: boolean; canReply?: boolean; credit?: boolean; note?: string; actionUrl?: string }) => {
  const { title, intro, order, store, settings } = input
  const storeName = safeSenderName(settings.editableStoreName ?? store.name)
  const accent = safeColor(settings.storeAccent)
  const accentInk = readableInk(accent)
  const logo = safeImageUrl(settings.storeLogo)
  const contactEmail = String(settings.contactEmail ?? '').trim()
  const contactPhone = String(settings.contactPhone ?? '').trim()
  const businessName = String(settings.businessName ?? '').trim()
  const support = [contactEmail, contactPhone].filter(Boolean).join(' · ')
  const deliveryPrice = input.credit ? Number(order.total) - Number(order.product_subtotal) : Math.max(0, Number(order.total) - Number(order.product_subtotal))
  const vatLine = order.seller_vat_registered
    ? `<tr><td style="padding:5px 0">sh käibemaks ${escapeHtml(order.seller_vat_rate)}%</td><td style="padding:5px 0;text-align:right">${formatMoney(order.seller_vat_amount)}</td></tr>`
    : '<tr><td colspan="2" style="padding:6px 0;color:#8a857d;font-size:12px">Müüja ei ole käibemaksukohustuslane.</td></tr>'
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
            <div style="margin-bottom:14px;color:#77736a;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">${input.credit ? 'Makse tagastatud' : input.seller ? 'Uus tellimus' : 'Tellimus kinnitatud'}</div>
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
              <tr><td style="padding:5px 0">Tarne</td><td style="padding:5px 0;text-align:right">${deliveryPrice !== 0 ? formatMoney(deliveryPrice) : 'Tasuta'}</td></tr>
              ${vatLine}
              <tr><td style="padding-top:14px;color:#171714;font-size:19px;font-weight:800">Kokku</td><td style="padding-top:14px;text-align:right;color:#171714;font-size:19px;font-weight:800">${formatMoney(order.total)}</td></tr>
            </table>
            <div style="margin-top:26px;padding:18px 20px;border-radius:14px;background:#f6f4ef;color:#666159;font-size:14px;line-height:1.55"><strong style="color:#23221f">Tarne</strong><br>${escapeHtml(order.delivery)}</div>
            ${!input.seller ? `<p style="margin:26px 0 0;color:#77736a;font-size:13px;line-height:1.6">${escapeHtml(input.note ?? 'Hakkame tellimust ette valmistama.')}${input.canReply ? ' Küsimuste korral vasta sellele kirjale.' : ''}</p>` : ''}
            ${input.actionUrl ? `<p style="margin:24px 0 0"><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;padding:14px 20px;border-radius:10px;background:${accent};color:${accentInk};text-decoration:none">Vaata tellimust ja arveid</a></p>` : ''}
          </div>
        </td></tr>
        <tr><td style="padding:22px 4px 0;color:#8a857d;font-size:12px;line-height:1.6">${escapeHtml(businessName || storeName)}${order.seller_vat_registered && order.seller_vat_number ? ` · KMKR ${escapeHtml(order.seller_vat_number)}` : ''}${support ? ` · ${escapeHtml(support)}` : ''}<br>Pood töötab <a href="https://poeruum.ee" style="color:#77736a;text-decoration:none">Poeruumil</a>.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
