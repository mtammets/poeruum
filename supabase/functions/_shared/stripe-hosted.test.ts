import { describe, expect, it } from 'vitest'
import { dedicatedStripeAccountParams, hostedSellerError, isDedicatedStripeAccount, stripeHostedLinkParams, stripeReturnOrigin } from './stripe-hosted'

describe('Stripe-hosted dedicated account onboarding', () => {
  it('enables legal entity reuse without requesting access to an existing account', () => {
    const params = dedicatedStripeAccountParams({ id: 'store', name: 'Ateljee', settings: { sellerType: 'entrepreneur', sellerFirstName: 'Liisa', sellerLastName: 'Tamm' } }, 'owner', 'seller@example.com')
    expect(params).toMatchObject({ business_type: 'individual', country: 'EE', controller: { requirement_collection: 'stripe', fees: { payer: 'application' }, losses: { payments: 'application' }, stripe_dashboard: { type: 'express' } } })
    expect(params).not.toHaveProperty('individual')
    expect(params).not.toHaveProperty('company')
    expect(params).not.toHaveProperty('external_account')
    expect(isDedicatedStripeAccount(params, 'store')).toBe(true)
    expect(isDedicatedStripeAccount(params, 'other')).toBe(false)
    expect(isDedicatedStripeAccount({ ...params, metadata: {} }, 'store')).toBe(false)
    expect(hostedSellerError({ country: 'EE', business_type: 'company' }, { sellerType: 'entrepreneur' })).toContain('eraisiku')
  })
  it('requires the Stripe legal identity to match, including missing names', () => {
    const settings = { sellerType: 'entrepreneur', sellerFirstName: 'Liisa', sellerLastName: 'Tamm' }
    const account = { country: 'EE', business_type: 'individual', individual: { first_name: 'Liisa', last_name: 'Tamm' } }
    expect(hostedSellerError(account, settings)).toBeNull()
    expect(hostedSellerError({ ...account, individual: { first_name: 'Jaan', last_name: 'Kask' } }, settings)).toContain('nimi')
    expect(hostedSellerError({ ...account, individual: null }, settings)).toBeTruthy()
    expect(hostedSellerError({ country: 'EE', business_type: 'company', company: { name: 'Pood OÜ', registration_number: '87654321' } }, { businessName: 'Pood OÜ', registryCode: '12345678' })).toContain('registrikood')
  })
  it('accepts only the configured app or this shop’s own return origin', () => {
    expect(stripeReturnOrigin('http://127.0.0.1:4187', 'http://127.0.0.1:4187', 'test', 'shop')).toBe('http://127.0.0.1:4187')
    expect(stripeReturnOrigin('https://shop.poeruum.ee', 'https://poeruum.ee', 'live', 'shop')).toBe('https://shop.poeruum.ee')
    expect(stripeReturnOrigin('https://atelier.ee', 'https://poeruum.ee', 'live', 'shop', 'atelier.ee')).toBe('https://atelier.ee')
    for (const origin of ['https://evil.test', 'https://other.poeruum.ee', 'http://shop.poeruum.ee', 'https://poeruum.ee.evil.test', 'https://name@poeruum.ee']) {
      expect(() => stripeReturnOrigin(origin, 'https://poeruum.ee', 'live', 'shop')).toThrow()
    }
    expect(() => stripeReturnOrigin('http://127.0.0.1:4187', 'http://127.0.0.1:4187', 'live', 'shop')).toThrow()
    expect(stripeHostedLinkParams('acct_dedicated', 'https://poeruum.ee')).toEqual({ account: 'acct_dedicated', type: 'account_onboarding', return_url: 'https://poeruum.ee/stripe/connect/return', refresh_url: 'https://poeruum.ee/stripe/connect/return?refresh=1', collection_options: { fields: 'eventually_due' } })
  })
})
