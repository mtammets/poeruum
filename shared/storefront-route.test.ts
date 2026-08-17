import { describe, expect, it } from 'vitest'
import {
  decodePathname,
  getProductSlugFromPath,
  getStoreSlugFromHostname,
  getStoreSlugFromPath,
} from './storefront-route.mjs'

describe('shared storefront server and browser routing', () => {
  it('accepts valid storefront hosts and rejects reserved or nested hosts', () => {
    expect(getStoreSlugFromHostname('minu-pood.poeruum.ee')).toBe('minu-pood')
    expect(getStoreSlugFromHostname('admin.poeruum.ee')).toBeNull()
    expect(getStoreSlugFromHostname('kaubamaja.poeruum.ee')).toBeNull()
    expect(getStoreSlugFromHostname('foo.bar.poeruum.ee')).toBeNull()
  })

  it('parses and validates encoded store paths without throwing', () => {
    expect(getStoreSlugFromPath('/p/minu-pood/toode/kruus/')).toBe('minu-pood')
    expect(getStoreSlugFromPath('/p/%E0%A4%A')).toBeNull()
    expect(getStoreSlugFromPath('/p/../')).toBeNull()
  })

  it('decodes request paths safely for static-file routing', () => {
    expect(decodePathname('/images/logo%20dark.svg')).toBe('/images/logo dark.svg')
    expect(decodePathname('/p/%E0%A4%A')).toBeNull()
  })

  it('parses product slugs and legacy UUID identifiers', () => {
    expect(getProductSlugFromPath('/toode/sinine-kruus/')).toBe('sinine-kruus')
    expect(getProductSlugFromPath('/p/pood/toode/123e4567-e89b-12d3-a456-426614174000/'))
      .toBe('123e4567-e89b-12d3-a456-426614174000')
    expect(getProductSlugFromPath('/toode/%E0%A4%A/')).toBeNull()
  })
})
