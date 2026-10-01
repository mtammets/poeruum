import { parseInvoiceBuyer, type InvoiceBuyer } from './order-invoice.ts'
import { sellerName, sellerType } from './seller.ts'

// Paying for a plan does not require an already connected payout account.
export function platformBillingBuyer(settings: Record<string, unknown>, fallbackEmail: string): InvoiceBuyer {
  const company = sellerType(settings) === 'company'
  const name = sellerName(settings)
  return parseInvoiceBuyer({
    company, name, address: settings.businessAddress,
    registryCode: company ? settings.registryCode : '',
    vatNumber: company && settings.vatRegistered === true ? settings.vatNumber : '',
  }, { name, email: String(settings.contactEmail || fallbackEmail) })
}

export function subscriptionInvoiceAmounts(invoice: Record<string, unknown>) {
  const cents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  const gross = invoice.total
  if (!cents(gross)) throw new Error('Invalid subscription invoice total')
  const taxes = invoice.total_taxes ?? invoice.total_tax_amounts
  let vat: number
  if (Array.isArray(taxes)) {
    vat = taxes.reduce((sum, item) => {
      if (!cents(item?.amount)) throw new Error('Invalid subscription invoice tax')
      return sum + item.amount
    }, 0)
  } else if (cents(invoice.tax)) vat = invoice.tax
  else if (cents(invoice.total_excluding_tax)) vat = gross - invoice.total_excluding_tax
  else if (gross === 0) vat = 0
  else throw new Error('Subscription invoice tax breakdown is missing')
  const net = gross - vat
  if (!cents(net) || !cents(vat) || (cents(invoice.total_excluding_tax) && net !== invoice.total_excluding_tax)) {
    throw new Error('Subscription invoice tax breakdown does not reconcile')
  }
  return { net, vat, gross }
}
