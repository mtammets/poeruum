import { describe, expect, it } from 'vitest'
import { hasSellerDetails, normalizeSellerSettings, sellerDetailsError, sellerName } from './seller'
import { buildInvoiceSnapshot, orderDocumentLabel } from './order-invoice'
import { getStripePrefill } from '../supabase/functions/_shared/stripe-connect-prefill'

const entrepreneur = { sellerType: 'entrepreneur', sellerFirstName: ' Liisa ', sellerLastName: ' Tamm ',
  businessAddress: 'Kase 12, Tartu', contactEmail: 'liisa@example.com', vatRegistered: false }
const company = { businessName: 'Näidis OÜ', registryCode: '12345678', businessAddress: 'Kase 12, Tartu', contactEmail: 'pood@example.com' }

describe('seller identity across onboarding, payments and purchase documents', () => {
  it('accepts an entrepreneur without a registry code and preserves the legacy company requirement', () => {
    expect(hasSellerDetails(entrepreneur)).toBe(true)
    expect(hasSellerDetails({ ...entrepreneur, entrepreneurAccountConfirmed: false })).toBe(true)
    expect(sellerName(entrepreneur)).toBe('Liisa Tamm')
    expect(hasSellerDetails(company)).toBe(true)
    expect(hasSellerDetails({ ...company, registryCode: '' })).toBe(false)
    expect(hasSellerDetails({ ...entrepreneur, sellerType: 'unknown' })).toBe(false)
    expect(hasSellerDetails({ ...entrepreneur, sellerType: null })).toBe(false)
  })
  it('requires both legal names, contact information and non-VAT status', () => {
    for (const patch of [{ sellerFirstName: '' }, { sellerLastName: '' }, { sellerLastName: 'Tam\nm' }, { businessAddress: '' },
      { contactEmail: 'invalid' }, { vatRegistered: true }, { vatNumber: 'EE123456789' }]) {
      expect(sellerDetailsError({ ...entrepreneur, ...patch })).not.toBeNull()
    }
  })
  it('clears hidden company values when switching to an individual', () => {
    expect(normalizeSellerSettings({ ...company, ...entrepreneur, vatRegistered: true, vatNumber: 'EE123456789' }))
      .toMatchObject({ businessName: 'Liisa Tamm', registryCode: '', vatRegistered: false, vatNumber: '' })
  })
  it('creates an individual Stripe identity without company fields or guessing a home address', () => {
    const prefill = getStripePrefill({ id: 'store', name: 'Liisa ateljee', settings: entrepreneur })
    expect(prefill.business_type).toBe('individual')
    expect(prefill.individual).toEqual({ first_name: 'Liisa', last_name: 'Tamm', email: 'liisa@example.com', address: { country: 'EE' } })
    expect(prefill).not.toHaveProperty('company')
    expect(JSON.stringify(prefill)).not.toContain('Kase 12')
    expect(getStripePrefill({ id: 'store', name: 'Pood', settings: company }).business_type).toBe('company')
  })
  it('freezes the seller identity, clears identifiers and produces a receipt without VAT', () => {
    const snapshot = buildInvoiceSnapshot({ settings: { ...entrepreneur, registryCode: 'PRIVATE_ID', personalId: 'PRIVATE_ID', iban: 'PRIVATE_IBAN' },
      storeName: 'Liisa ateljee', storeSlug: 'liisa', buyer: { name: 'Mari Kask', email: 'mari@example.com', address: 'Tartu', company: false, registryCode: '', vatNumber: '' },
      delivery: 'Omniva', deliveryCents: 300, items: [{ name: 'Akvarell', quantity: 1, unitGrossCents: 6500, options: '' }] })
    expect(snapshot.seller).toEqual({ type: 'entrepreneur', name: 'Liisa Tamm', registryCode: '', address: 'Kase 12, Tartu', email: 'liisa@example.com', vatNumber: '' })
    expect(snapshot).toMatchObject({ vatRate: null, vatCents: 0, netCents: 6800, totalCents: 6800 })
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE')
    expect(orderDocumentLabel('invoice', snapshot.seller.type)).toBe('Müügitõend')
    expect(orderDocumentLabel('credit', snapshot.seller.type)).toBe('Tagastustõend')
    expect(orderDocumentLabel('invoice')).toBe('Arve')
    expect(orderDocumentLabel('credit', 'company')).toBe('Kreeditarve')
  })
})
