import { describe, expect, it } from 'vitest'
import { buildInvoiceSnapshot, invoiceLineDisplayAmounts, parseInvoiceBuyer } from './order-invoice'

const customer = { name: 'Õie Šašlik', email: 'OSTJA@example.invalid' }
const settings = { businessName: 'Näidispood OÜ', registryCode: '12345678', businessAddress: 'Pärna 1, Tallinn', contactEmail: 'pood@example.invalid', vatRegistered: true, vatNumber: 'EE123456789' }
const build = (amounts: number[], registered = true) => buildInvoiceSnapshot({
  settings: { ...settings, vatRegistered: registered }, storeName: 'Pood', storeSlug: 'pood',
  buyer: parseInvoiceBuyer({ address: 'Kase 2, Tartu' }, customer), delivery: 'Tulen ise järele', deliveryCents: 0,
  items: amounts.map((unitGrossCents, index) => ({ name: `Toode ${index}`, options: '', quantity: 1, unitGrossCents })),
})

describe('invoice data and inclusive VAT', () => {
  it('collects a private buyer without accidentally retaining hidden company fields', () => {
    expect(parseInvoiceBuyer({ company: false, name: 'Hidden company', registryCode: 'junk', vatNumber: 'junk', address: 'Kase 2' }, customer))
      .toEqual({ name: customer.name, email: 'ostja@example.invalid', company: false, registryCode: '', vatNumber: '', address: 'Kase 2' })
  })
  it('requires complete company data and a billing address', () => {
    expect(() => parseInvoiceBuyer({}, customer)).toThrow('Arve aadress')
    expect(() => parseInvoiceBuyer({ company: true, address: 'Kase 2', name: 'OÜ', registryCode: '12' }, customer)).toThrow('8-kohaline')
    expect(() => parseInvoiceBuyer({ address: 'Kase\n2' }, customer)).toThrow('Arve aadress')
    expect(() => parseInvoiceBuyer({ address: 'Kase 2' }, { ...customer, email: 'invalid' })).toThrow('e-post')
    expect(parseInvoiceBuyer({ company: true, address: 'Kase 2', name: 'Ostja OÜ', registryCode: '12345678', vatNumber: 'ee987654321' }, customer).vatNumber).toBe('EE987654321')
  })
  it('keeps non-VAT sellers distinct from a zero-rated VAT sale', () => {
    const invoice = build([12400], false)
    expect(invoice.vatRate).toBeNull()
    expect(invoice.seller.vatNumber).toBe('')
    expect(invoice.netCents).toBe(12400)
    expect(invoice.vatCents).toBe(0)
  })
  it('allocates rounding so all lines, VAT, net and the charged gross agree', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const amounts = Array.from({ length: seed % 50 + 1 }, (_, index) => (seed * 7919 + index * 71) % 10000 + 1)
      const invoice = build(amounts)
      expect(invoice.totalCents).toBe(amounts.reduce((a, b) => a + b, 0))
      expect(invoice.vatCents).toBe(Math.round(invoice.totalCents * 24 / 124))
      expect(invoice.lines.reduce((total, line) => total + line.vatCents, 0)).toBe(invoice.vatCents)
      expect(invoice.lines.reduce((total, line) => total + line.netCents, 0)).toBe(invoice.netCents)
      for (const line of invoice.lines) {
        expect(line.netCents + line.vatCents).toBe(line.grossCents)
        expect(Math.abs(line.vatCents - line.grossCents * 24 / 124)).toBeLessThan(1)
      }
    }
  })
  it('includes delivery in the taxable total and freezes the actual discounted unit price', () => {
    const invoice = buildInvoiceSnapshot({ settings, storeName: 'Pood', storeSlug: 'pood', buyer: parseInvoiceBuyer({ address: 'Kase 2' }, customer),
      delivery: 'Pakiautomaat', deliveryCents: 372, items: [{ name: 'Soodustoode', quantity: 2, unitGrossCents: 1240, options: 'Suurus: M' }] })
    expect(invoice.totalCents).toBe(2852)
    expect(invoice.vatCents).toBe(552)
    expect(invoice.lines[1].name).toBe('Tarne')
    settings.businessName = 'Muudetud nimi'
    expect(invoice.seller.name).toBe('Näidispood OÜ')
  })
  it('explains allocated VAT cents without changing equal unit prices or the paid total', () => {
    const invoice = build([999, 999])
    expect(invoice.lines.map((line) => invoiceLineDisplayAmounts(line, invoice.vatRate))).toEqual([
      { unitNetCents: 806, roundingCents: -1 },
      { unitNetCents: 806, roundingCents: 0 },
    ])
    expect(invoice.netCents).toBe(1611)
    expect(invoice.vatCents).toBe(387)
    expect(invoice.totalCents).toBe(1998)
  })
  it('reconciles two-decimal units and row totals for quantities up to 99, including delivery', () => {
    for (const registered of [true, false]) {
      for (let quantity = 1; quantity <= 99; quantity++) {
        const invoice = buildInvoiceSnapshot({ settings: { ...settings, vatRegistered: registered },
          storeName: 'Pood', storeSlug: 'pood', buyer: parseInvoiceBuyer({ address: 'Kase 2' }, customer),
          delivery: 'Pakiautomaat', deliveryCents: 350,
          items: [999, 1, 1240].map((unitGrossCents) => ({ name: 'Toode', options: '', quantity, unitGrossCents })),
        })
        const before = JSON.stringify(invoice)
        let displayedNetCents = 0
        for (const line of invoice.lines) {
          const { unitNetCents, roundingCents } = invoiceLineDisplayAmounts(line, invoice.vatRate)
          expect(Number.isSafeInteger(unitNetCents)).toBe(true)
          expect(Number.isSafeInteger(roundingCents)).toBe(true)
          expect(unitNetCents * line.quantity + roundingCents).toBe(line.netCents)
          if (!registered) expect(roundingCents).toBe(0)
          displayedNetCents += unitNetCents * line.quantity + roundingCents
        }
        expect(displayedNetCents + invoice.vatCents).toBe(invoice.totalCents)
        expect(JSON.stringify(invoice)).toBe(before)
      }
    }
  })
  it('shows both positive and negative adjustments when rounding a net unit to cents', () => {
    expect(invoiceLineDisplayAmounts(build([1]).lines[0], 24)).toEqual({ unitNetCents: 1, roundingCents: 0 })
    const invoice = buildInvoiceSnapshot({ settings, storeName: 'Pood', storeSlug: 'pood',
      buyer: parseInvoiceBuyer({ address: 'Kase 2' }, customer), delivery: 'Järeletulemine', deliveryCents: 0,
      items: [{ name: 'Toode', options: '', quantity: 3, unitGrossCents: 100 }],
    })
    expect(invoiceLineDisplayAmounts(invoice.lines[0], 24)).toEqual({ unitNetCents: 81, roundingCents: -1 })
    const cheaper = buildInvoiceSnapshot({ settings, storeName: 'Pood', storeSlug: 'pood',
      buyer: invoice.buyer, delivery: 'Järeletulemine', deliveryCents: 0,
      items: [{ name: 'Toode', options: '', quantity: 3, unitGrossCents: 99 }],
    })
    expect(invoiceLineDisplayAmounts(cheaper.lines[0], 24)).toEqual({ unitNetCents: 80, roundingCents: 0 })
    const positive = buildInvoiceSnapshot({ settings, storeName: 'Pood', storeSlug: 'pood',
      buyer: invoice.buyer, delivery: 'Järeletulemine', deliveryCents: 0,
      items: [{ name: 'Toode', options: '', quantity: 3, unitGrossCents: 101 }],
    })
    expect(invoiceLineDisplayAmounts(positive.lines[0], 24)).toEqual({ unitNetCents: 81, roundingCents: 1 })
  })
})
