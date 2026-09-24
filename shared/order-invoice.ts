export type InvoiceBuyer = {
  name: string
  email: string
  address: string
  company: boolean
  registryCode: string
  vatNumber: string
}

export type InvoiceLine = {
  kind: 'product' | 'shipping'
  image?: string
  name: string
  options: string
  quantity: number
  unitGrossCents: number
  grossCents: number
  netCents: number
  vatCents: number
}

export type InvoiceSnapshot = {
  version: 1
  currency: 'eur'
  seller: { name: string; registryCode: string; address: string; email: string; vatNumber: string }
  buyer: InvoiceBuyer
  storeName: string
  storeSlug: string
  storeAccent: string
  storeLogo: string
  sellerEmail: string
  delivery: string
  lines: InvoiceLine[]
  vatRate: number | null
  netCents: number
  vatCents: number
  totalCents: number
}

export type InvoiceDocumentSummary = {
  id: string
  number: string
  kind: 'invoice' | 'credit'
  ready: boolean
}

export type InvoiceDocument = {
  id: string
  order_id: string
  order_number: string
  number: string
  kind: 'invoice' | 'credit'
  original_number: string | null
  issued_at: string
  paid_at: string
  snapshot: InvoiceSnapshot
  stripe_mode: 'test' | 'live'
  status: 'pending' | 'processing' | 'retry' | 'ready' | 'needs_review'
  lease_token: string | null
  pdf_sha256: string | null
}

export class InvoiceInputError extends Error {
  constructor(public readonly publicMessage: string) { super(publicMessage) }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const field = (value: unknown, label: string, maximum = 200, required = true) => {
  const text = typeof value === 'string' ? value.normalize('NFC').trim() : ''
  if ((required && !text) || text.length > maximum || Array.from(text).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new InvoiceInputError(`${label} puudub või on vigane.`)
  return text
}
const email = (value: unknown, label: string) => {
  const text = field(value, label, 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new InvoiceInputError(`${label} on vigane.`)
  return text
}

export function parseInvoiceBuyer(value: unknown, customer: { name: string; email: string }): InvoiceBuyer {
  const input = record(value)
  const company = input.company === true
  const registryCode = company ? field(input.registryCode, 'Ettevõtte registrikood', 8) : ''
  if (company && !/^\d{8}$/.test(registryCode)) throw new InvoiceInputError('Ettevõtte registrikood peab olema 8-kohaline.')
  const vatNumber = company ? field(input.vatNumber, 'KMKR number', 11, false).toUpperCase() : ''
  if (vatNumber && !/^EE\d{9}$/.test(vatNumber)) throw new InvoiceInputError('KMKR number peab olema kujul EE123456789.')
  return {
    company, registryCode, vatNumber,
    name: field(company ? input.name : customer.name, company ? 'Ettevõtte nimi' : 'Ostja nimi'),
    email: email(customer.email, 'Ostja e-post'),
    address: field(input.address, 'Arve aadress', 400),
  }
}

// Allocate VAT in cents across rows while preserving both the amount charged
// and the existing order-level inclusive-tax rounding. Never use float euros
// or mutable product prices when rendering a fiscal document.
export function buildInvoiceSnapshot(input: {
  settings: Record<string, unknown>
  storeName: string
  storeSlug: string
  buyer: InvoiceBuyer
  delivery: string
  items: Array<{ name: string; options: string; quantity: number; unitGrossCents: number; image?: string }>
  deliveryCents: number
}): InvoiceSnapshot {
  const settings = input.settings
  const registered = settings.vatRegistered === true
  const registryCode = field(settings.registryCode, 'Müüja registrikood', 8)
  if (!/^\d{8}$/.test(registryCode)) throw new InvoiceInputError('Müüja registrikood peab olema 8-kohaline.')
  const vatNumber = registered ? field(settings.vatNumber, 'Müüja KMKR number', 11).toUpperCase() : ''
  if (registered && !/^EE\d{9}$/.test(vatNumber)) throw new InvoiceInputError('Müüja KMKR number on vigane.')
  const seller = {
    name: field(settings.businessName, 'Müüja nimi'), registryCode,
    address: field(settings.businessAddress, 'Müüja aadress', 400),
    email: email(settings.contactEmail, 'Poe kontakt-e-post'), vatNumber,
  }
  if (!Number.isSafeInteger(input.deliveryCents) || input.deliveryCents < 0) throw new InvoiceInputError('Tarne summa on vigane.')
  const source = [...input.items, ...(input.deliveryCents > 0 ? [{ name: 'Tarne', options: '', quantity: 1, unitGrossCents: input.deliveryCents }] : [])]
  if (!source.length || source.length > 51) throw new InvoiceInputError('Arve read on vigased.')
  const lines: InvoiceLine[] = source.map((item, index) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99
      || !Number.isSafeInteger(item.unitGrossCents) || item.unitGrossCents <= 0) throw new InvoiceInputError('Arve kogus või ühikuhind on vigane.')
    const grossCents = item.quantity * item.unitGrossCents
    if (!Number.isSafeInteger(grossCents)) throw new InvoiceInputError('Arve summa on liiga suur.')
    const vatCents = registered ? Math.floor(grossCents * 24 / 124) : 0
    return { ...item, kind: index < input.items.length ? 'product' : 'shipping', name: field(item.name, 'Toote nimi', 500), options: field(item.options, 'Toote valikud', 1000, false), grossCents, vatCents, netCents: grossCents - vatCents }
  })
  const totalCents = lines.reduce((total, line) => total + line.grossCents, 0)
  if (!Number.isSafeInteger(totalCents) || totalCents > 99_999_999) throw new InvoiceInputError('Arve summa on liiga suur.')
  const vatCents = registered ? Math.round(totalCents * 24 / 124) : 0
  const ranked = lines.map((line, index) => ({ index, remainder: (line.grossCents * 24) % 124 }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  const remaining = vatCents - lines.reduce((total, line) => total + line.vatCents, 0)
  for (let index = 0; index < remaining; index++) {
    const line = lines[ranked[index].index]
    line.vatCents += 1
    line.netCents -= 1
  }
  return {
    version: 1, currency: 'eur', seller, buyer: input.buyer,
    storeName: field(settings.editableStoreName || input.storeName, 'Poe nimi'), storeSlug: input.storeSlug,
    storeAccent: /^#[0-9a-f]{6}$/i.test(String(settings.storeAccent ?? '')) ? String(settings.storeAccent) : '#e5f25a',
    storeLogo: typeof settings.storeLogo === 'string' && settings.storeLogo.length <= 2048 && settings.storeLogo.startsWith('https://') ? settings.storeLogo : '',
    sellerEmail: typeof settings.orderNotificationEmail === 'string' && settings.orderNotificationEmail.trim().length <= 254
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.orderNotificationEmail.trim()) ? settings.orderNotificationEmail.trim().toLowerCase() : seller.email,
    delivery: field(input.delivery, 'Tarne', 1000), lines,
    vatRate: registered ? 24 : null, netCents: totalCents - vatCents, vatCents, totalCents,
  }
}
