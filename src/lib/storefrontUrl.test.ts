import { describe, expect, it } from 'vitest'
import {
  getMerchantLoginUrl,
  getMerchantStoreUrl,
  getSharedAuthDomain,
  isMerchantManagementLocation,
  getRequestedProductSlug,
  getRequestedStoreSlug,
  getStorefrontCanonicalUrl,
  getStorefrontPath,
  isDedicatedStorefrontHostname,
  getStoreSlugFromHostname,
  isPlatformHostname,
  isReservedStoreSlug,
  isStoreDirectoryHostname,
} from './storefrontUrl'

describe('storefront URL parsing', () => {
  it('opens only the authenticated shop address and preserves payment return intents', () => {
    expect(getMerchantStoreUrl('urgits', new URL('https://poeruum.ee/?continue_setup=1')))
      .toBe('https://urgits.poeruum.ee/haldus')
    expect(getMerchantStoreUrl('kruk-kruk', new URL('https://urgits.poeruum.ee/haldus?stripe_requirements=1&returnTo=https://evil.test#token')))
      .toBe('https://kruk-kruk.poeruum.ee/haldus?stripe_requirements=1')
    expect(getMerchantStoreUrl('urgits', new URL('https://poeruum.ee/?billing=success')))
      .toBe('https://urgits.poeruum.ee/haldus?billing=success')
    expect(getMerchantStoreUrl('urgits', new URL('http://127.0.0.1:4185/'))).toBeNull()
    expect(getMerchantStoreUrl('https://evil.test', new URL('https://poeruum.ee'))).toBeNull()
    expect(getMerchantStoreUrl('admin', new URL('https://poeruum.ee'))).toBeNull()
  })

  it('limits shared login and management routes to first-party hosts', () => {
    expect(getSharedAuthDomain('urgits.poeruum.ee')).toBe('poeruum.ee')
    expect(getSharedAuthDomain('poeruum.ee.example.com')).toBeNull()
    expect(getSharedAuthDomain('custom.ee')).toBeNull()
    expect(getSharedAuthDomain('shop.poeruum.localhost', 'poeruum.localhost')).toBe('poeruum.localhost')
    expect(isMerchantManagementLocation(new URL('https://urgits.poeruum.ee/haldus'))).toBe(true)
    expect(isMerchantManagementLocation(new URL('https://urgits.poeruum.ee/'))).toBe(false)
    expect(isMerchantManagementLocation(new URL('https://urgits.poeruum.ee/?billing=success'))).toBe(true)
    expect(isMerchantManagementLocation(new URL('https://urgits.poeruum.ee/?stripe_connect=return'))).toBe(true)
    expect(isMerchantManagementLocation(new URL('https://urgits.poeruum.ee/?checkout=success'))).toBe(false)
    expect(isMerchantManagementLocation(new URL('https://custom.ee/haldus'))).toBe(false)
  })

  it.each([
    ['https://kruk-kruk.poeruum.ee', 'https://poeruum.ee/?continue_setup=1'],
    ['https://urgits.poeruum.ee', 'https://poeruum.ee/?continue_setup=1'],
    ['https://minupood.ee', 'https://poeruum.ee/?continue_setup=1'],
    ['https://www.poeruum.ee', 'https://poeruum.ee/?continue_setup=1'],
    ['https://poeruum.ee.example.com', 'https://poeruum.ee/?continue_setup=1'],
    ['http://kruk-kruk.localhost:4174', 'http://localhost:4174/?continue_setup=1'],
    ['http://localhost:4174', 'http://localhost:4174/?continue_setup=1'],
    ['http://127.0.0.1:4185', 'http://127.0.0.1:4185/?continue_setup=1'],
    ['http://192.168.1.50:5173', 'http://192.168.1.50:5173/?continue_setup=1'],
  ])('opens merchant login on the platform from %s', (origin, expected) => {
    expect(getMerchantLoginUrl(new URL(origin))).toBe(expected)
  })

  it('extracts only a single valid store subdomain', () => {
    expect(getStoreSlugFromHostname('minu-pood.poeruum.ee')).toBe('minu-pood')
    expect(getStoreSlugFromHostname('toode.minu-pood.poeruum.ee')).toBeNull()
    expect(getStoreSlugFromHostname('poeruum.ee')).toBeNull()
  })

  it('blocks reserved infrastructure subdomains', () => {
    expect(isReservedStoreSlug('ADMIN')).toBe(true)
    expect(getStoreSlugFromHostname('support.poeruum.ee')).toBeNull()
    expect(getStoreSlugFromHostname('kaubamaja.poeruum.ee')).toBeNull()
  })

  it('recognizes the first-party store directory in production and local preview', () => {
    expect(isStoreDirectoryHostname('kaubamaja.poeruum.ee')).toBe(true)
    expect(isStoreDirectoryHostname('kaubamaja.localhost')).toBe(true)
    expect(isStoreDirectoryHostname('minu-pood.poeruum.ee')).toBe(false)
  })

  it('falls back to encoded path and query store identifiers', () => {
    expect(getRequestedStoreSlug({
      hostname: 'poeruum.ee',
      pathname: '/p/minu-pood/',
      search: '',
    })).toBe('minu-pood')
    expect(getRequestedStoreSlug({
      hostname: 'poeruum.ee',
      pathname: '/',
      search: '?store=teine-pood',
    })).toBe('teine-pood')
  })

  it('parses product slugs without accepting arbitrary paths', () => {
    expect(getRequestedProductSlug({ pathname: '/p/minu-pood/toode/kruus/' })).toBe('kruus')
    expect(getRequestedProductSlug({ pathname: '/p/minu-pood/toode/%2Fadmin/' })).toBeNull()
  })

  it('builds canonical storefront paths', () => {
    expect(getStorefrontPath('minu-pood')).toBe('/p/minu-pood/')
    expect(getStorefrontPath('minu-pood', { id: '1', slug: 'kruus' })).toBe('/p/minu-pood/toode/kruus/')
  })

  it('builds canonical URLs on the dedicated storefront hostname', () => {
    expect(getStorefrontCanonicalUrl('minu-pood')).toBe('https://minu-pood.poeruum.ee/')
    expect(getStorefrontCanonicalUrl('minu-pood', { id: '1', slug: 'kruus' }, 'minupood.ee'))
      .toBe('https://minupood.ee/toode/kruus/')
  })

  it('recognizes both Poeruum subdomains and merchant-owned domains', () => {
    expect(isDedicatedStorefrontHostname('minu-pood.poeruum.ee')).toBe(true)
    expect(isDedicatedStorefrontHostname('minupood.ee')).toBe(true)
    expect(isDedicatedStorefrontHostname('poeruum.ee')).toBe(false)
  })

  it('recognizes platform routes opened from a private development network', () => {
    expect(isPlatformHostname('172.16.1.177')).toBe(true)
    expect(isPlatformHostname('192.168.1.50')).toBe(true)
    expect(isPlatformHostname('10.0.0.8')).toBe(true)
    expect(isPlatformHostname('127.0.0.1')).toBe(true)
    expect(isPlatformHostname('::1')).toBe(true)
  })

  it('does not mistake public store hosts for a private platform preview', () => {
    expect(isPlatformHostname('minupood.ee')).toBe(false)
    expect(isPlatformHostname('8.8.8.8')).toBe(false)
    expect(isPlatformHostname('172.32.1.1')).toBe(false)
    expect(isPlatformHostname('nested.minu-pood.poeruum.ee')).toBe(false)
  })
})
