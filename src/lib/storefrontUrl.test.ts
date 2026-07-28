import { describe, expect, it } from 'vitest'
import {
  getRequestedProductSlug,
  getRequestedStoreSlug,
  getStorefrontCanonicalUrl,
  getStorefrontPath,
  isDedicatedStorefrontHostname,
  getStoreSlugFromHostname,
  isPlatformHostname,
  isReservedStoreSlug,
} from './storefrontUrl'

describe('storefront URL parsing', () => {
  it('extracts only a single valid store subdomain', () => {
    expect(getStoreSlugFromHostname('minu-pood.poeruum.ee')).toBe('minu-pood')
    expect(getStoreSlugFromHostname('toode.minu-pood.poeruum.ee')).toBeNull()
    expect(getStoreSlugFromHostname('poeruum.ee')).toBeNull()
  })

  it('blocks reserved infrastructure subdomains', () => {
    expect(isReservedStoreSlug('ADMIN')).toBe(true)
    expect(getStoreSlugFromHostname('support.poeruum.ee')).toBeNull()
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
