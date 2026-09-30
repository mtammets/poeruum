import { describe, expect, it, vi } from 'vitest'
import { createStripeOAuthState, revokeStripeOAuthAccount, existingStripeAccountError, exchangeStripeOAuthCode, hashOAuthState, stripeAccountReady, stripeOAuthUrl } from './stripe-oauth'

const settings = { sellerType: 'entrepreneur', sellerFirstName: 'Liisa', sellerLastName: 'Tamm' }
const account = { id: 'acct_existing', type: 'standard', country: 'EE', business_type: 'individual', individual: { first_name: 'Liisa', last_name: 'Tamm' }, charges_enabled: true, payouts_enabled: true, capabilities: { transfers: 'active' } }

describe('existing Stripe account authorization', () => {
  it('requires an exact safe callback and binds the authorization to a random state', async () => {
    const url = new URL(stripeOAuthUrl('ca_test', 'http://127.0.0.1:4187', 'state', 'test'))
    expect(url.origin).toBe('https://connect.stripe.com')
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'ca_test', response_type: 'code', scope: 'read_write', state: 'state', redirect_uri: 'http://127.0.0.1:4187/stripe/connect/callback' })
    expect(() => stripeOAuthUrl('ca_test', 'http://example.com', 'state', 'test')).toThrow()
    expect(() => stripeOAuthUrl('ca_live', 'http://localhost', 'state', 'live')).toThrow()
    expect(() => stripeOAuthUrl('', 'https://poeruum.ee', 'state', 'live')).toThrow()
    expect(await hashOAuthState('state')).toMatch(/^[a-f0-9]{64}$/)
    expect(createStripeOAuthState('https://shop.example.com', 'live')).toMatch(/\|https:\/\/shop.example.com$/)
    expect(() => createStripeOAuthState('https://shop.example.com/redirect', 'live')).toThrow()
    expect(() => createStripeOAuthState('http://shop.example.com', 'live')).toThrow()
    expect(await hashOAuthState('other')).not.toBe(await hashOAuthState('state'))
  })

  it('checks the seller identity without changing the existing account', () => {
    const original = structuredClone(account)
    expect(existingStripeAccountError(account, settings)).toBeNull()
    expect(existingStripeAccountError(account, { ...settings, sellerLastName: 'Kask' })).toContain('nimi')
    expect(existingStripeAccountError({ ...account, business_type: 'company' }, settings)).toContain('eraisiku')
    expect(existingStripeAccountError({ ...account, individual: {} }, settings)).toContain('Täienda')
    expect(existingStripeAccountError({ ...account, country: 'US' }, settings)).toContain('Eestis')
    expect(existingStripeAccountError({ ...account, type: 'express' }, settings)).toContain('iseseisev')
    expect(existingStripeAccountError({ ...account, business_type: 'company', company: { name: 'Näidis OÜ', registration_number: '12345679' } }, { businessName: 'Näidis OÜ', registryCode: '12345678' })).toContain('registrikood')
    expect(account).toEqual(original)
    expect(stripeAccountReady(account)).toBe(true)
    expect(stripeAccountReady({ ...account, capabilities: { transfers: 'inactive' } })).toBe(false)
  })

  it('discards OAuth tokens and rejects read-only and cross-mode authorization', async () => {
    const valid = { stripe_user_id: 'acct_existing', scope: 'read_write', livemode: false, access_token: 'sensitive', refresh_token: 'sensitive' }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(valid)))
    expect(await exchangeStripeOAuthCode('sk_test_local', 'ac_once', 'test', fetcher)).toBe('acct_existing')
    for (const invalid of [{ ...valid, scope: 'read_only' }, { ...valid, livemode: true }, { error: 'invalid_grant', error_description: 'sensitive' }]) {
      await expect(exchangeStripeOAuthCode('sk_test_local', 'ac_once', 'test', async () => new Response(JSON.stringify(invalid)))).rejects.not.toThrow('sensitive')
    }
    const lost = vi.fn(async () => { throw new Error('Connection lost') })
    await expect(exchangeStripeOAuthCode('sk_test_local', 'ac_once', 'test', lost)).rejects.toThrow()
    expect(lost).toHaveBeenCalledTimes(1)
  })
  it('removes platform access without deleting the seller account', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ stripe_user_id: 'acct_existing' })))
    await revokeStripeOAuthAccount('sk_test_local', 'ca_test', 'acct_existing', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://connect.stripe.com/oauth/deauthorize')
    expect(request.method).toBe('POST')
    expect(String(request.body)).toBe('client_id=ca_test&stripe_user_id=acct_existing')
  })

})
