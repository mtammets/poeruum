import { describe, expect, it } from 'vitest'
import { buildInvoiceSnapshot, parseInvoiceBuyer } from './order-invoice'
import { calculateOrderTotals, moneyToCents } from './order-pricing'

const items = [
  { unitGrossCents: moneyToCents(3.26), quantity: 10 },
  { unitGrossCents: moneyToCents(17.40), quantity: 1 },
]

describe('storefront and Stripe totals', () => {
  it.each([
    { threshold: 49.99, delivery: 0, total: 5000, vat: 968 },
    { threshold: 50, delivery: 0, total: 5000, vat: 968 },
    { threshold: 50.01, delivery: 350, total: 5350, vat: 1035 },
    { threshold: 0, delivery: 350, total: 5350, vat: 1035 },
  ])('handles the free delivery boundary at €$threshold in cents', ({ threshold, delivery, total, vat }) => {
    expect(calculateOrderTotals({ items, deliveryCents: moneyToCents(3.50),
      freeShippingFromCents: moneyToCents(threshold), vatRegistered: true,
    })).toEqual({ productSubtotalCents: 5000, deliveryCents: delivery, totalCents: total, vatCents: vat })
  })
  it('supports free pickup and sellers who do not charge VAT', () => {
    expect(calculateOrderTotals({ items, deliveryCents: 0, freeShippingFromCents: 0, vatRegistered: false }))
      .toEqual({ productSubtotalCents: 5000, deliveryCents: 0, totalCents: 5000, vatCents: 0 })
  })
  it('agrees with invoice totals for discounted prices, quantities, paid/free shipping and VAT status', () => {
    const settings = { businessName: 'Pood OÜ', registryCode: '12345678', businessAddress: 'Tallinn',
      contactEmail: 'pood@example.invalid', vatNumber: 'EE123456789' }
    const buyer = parseInvoiceBuyer({ address: 'Tartu' }, { name: 'Ostja', email: 'ostja@example.invalid' })
    for (const vatRegistered of [true, false]) {
      for (const freeShippingFromCents of [0, 1998, 5000]) {
        const invoiceItems = [
          { name: 'Soodustoode', options: '', unitGrossCents: moneyToCents('9.99'), quantity: 2 },
          { name: 'Lisatoode', options: '', unitGrossCents: moneyToCents('0.03'), quantity: 3 },
        ]
        const totals = calculateOrderTotals({ items: invoiceItems, deliveryCents: 350, freeShippingFromCents, vatRegistered })
        const invoice = buildInvoiceSnapshot({ settings: { ...settings, vatRegistered }, buyer, storeName: 'Pood',
          storeSlug: 'pood', delivery: 'Pakiautomaat', deliveryCents: totals.deliveryCents, items: invoiceItems })
        expect(invoice.totalCents).toBe(totals.totalCents)
        expect(invoice.vatCents).toBe(totals.vatCents)
        expect(invoice.lines.filter((line) => line.kind === 'product').reduce((sum, line) => sum + line.grossCents, 0))
          .toBe(totals.productSubtotalCents)
      }
    }
  })
})
