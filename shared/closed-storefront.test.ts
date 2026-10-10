import { describe, expect, it } from 'vitest'
import { normalizeClosedStore, renderClosedStoreDocument } from './closed-storefront.mjs'

describe('closed storefront presentation', () => {
  it('only accepts branding fields and safe theme values', () => {
    expect(normalizeClosedStore({ name: '  Minu   pood ', logo: 'javascript:alert(1)', theme: '</style>', accent: 'red;display:none', products: ['private'], email: 'private@example.invalid' }))
      .toEqual({ name: 'Minu pood', logo: null, theme: 'midnight', accent: '#e5f25a' })
    expect(normalizeClosedStore(null)).toBeNull()
    expect(normalizeClosedStore({ name: '' })).toBeNull()
    expect(normalizeClosedStore({ name: 'Pood', logo: '//example.invalid/logo.svg' })?.logo).toBeNull()
  })

  it('escapes names and logo attributes without allowing markup or extra copy', () => {
    const html = renderClosedStoreDocument({ name: '<script>alert(1)</script>', logo: 'https://example.invalid/logo.png?x="onload="alert(1)', theme: 'paper', accent: '#cc6633' })
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('x=&quot;onload=&quot;alert(1)')
    expect(html).not.toContain('<script>alert(1)')
    expect(html).not.toContain('Loodud Poeruumis')
    expect(html).toContain('noindex, nofollow')
    expect(html).toContain('--closed-bg:#e8deca')
  })
})
