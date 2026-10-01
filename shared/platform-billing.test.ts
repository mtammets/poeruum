import { describe, expect, it } from 'vitest'
import { platformBillingBuyer, subscriptionInvoiceAmounts } from './platform-billing'
import { estonianBillingMonth, platformVatPercentAt } from './platform-business.mjs'

describe('platform registration and buyer identity', () => {
  it('uses Estonian midnight for registration and billing months', () => {
    expect(platformVatPercentAt('2026-09-30T20:59:59.999Z')).toBe(0)
    expect(platformVatPercentAt('2026-09-30T21:00:00.000Z')).toBe(24)
    expect(estonianBillingMonth('2026-09-30T20:59:59Z')).toBe('2026-09')
    expect(estonianBillingMonth('2026-09-30T21:00:00Z')).toBe('2026-10')
    expect(estonianBillingMonth('2026-10-31T22:00:00Z')).toBe('2026-11')
  })
  it('invoices an entrepreneur under their legal name without private IDs or VAT', () => {
    const buyer = platformBillingBuyer({ sellerType: 'entrepreneur', sellerFirstName: 'Liisa', sellerLastName: 'Tamm',
      businessName: 'Ateljee', businessAddress: 'Kase 1, Tartu', registryCode: 'PRIVATE_ID', vatNumber: 'EE123456789', vatRegistered: true,
    }, 'liisa@example.com')
    expect(buyer).toEqual({ company: false, name: 'Liisa Tamm', address: 'Kase 1, Tartu', registryCode: '', vatNumber: '', email: 'liisa@example.com' })
  })
  it('requires the service buyer address and business registry code', () => {
    expect(() => platformBillingBuyer({ businessName: 'Pood OÜ', registryCode: '12345678' }, 'pood@example.com')).toThrow('aadress')
    expect(() => platformBillingBuyer({ businessName: 'Pood OÜ', businessAddress: 'Tallinn' }, 'pood@example.com')).toThrow('registrikood')
  })
})

describe('subscription accounting', () => {
  it('records the discounted tax base rather than the pre-discount subtotal', () => {
    expect(subscriptionInvoiceAmounts({ total: 1798, subtotal_excluding_tax: 2900, total_excluding_tax: 1450,
      total_taxes: [{ amount: 348 }], amount_paid: 1798 })).toEqual({ net: 1450, vat: 348, gross: 1798 })
  })
  it('separates VAT from net even if Stripe omits subtotal_excluding_tax', () => {
    expect(subscriptionInvoiceAmounts({ total: 3596, total_tax_amounts: [{ amount: 696 }], amount_paid: 3596 }))
      .toEqual({ net: 2900, vat: 696, gross: 3596 })
  })
  it('does not treat customer-credit payments as zero revenue or invent missing tax data', () => {
    expect(subscriptionInvoiceAmounts({ total: 3596, total_excluding_tax: 2900, amount_paid: 0 })).toEqual({ net: 2900, vat: 696, gross: 3596 })
    expect(subscriptionInvoiceAmounts({ total: 0 })).toEqual({ net: 0, vat: 0, gross: 0 })
    expect(() => subscriptionInvoiceAmounts({ total: 3596, amount_paid: 3596 })).toThrow('missing')
    expect(() => subscriptionInvoiceAmounts({ total: 3596, total_excluding_tax: 2900, total_taxes: [{ amount: 1 }] })).toThrow('reconcile')
  })
})
