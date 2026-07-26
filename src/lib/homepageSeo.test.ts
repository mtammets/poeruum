import { describe, expect, it } from 'vitest'
import { getHomepageSeoValidationError, seoTextLength } from './homepageSeo'

const validSeo = {
  seoTitle: 'Poeruum – loo Eesti e-pood 10 minutiga',
  seoDescription: 'Loo professionaalne e-pood umbes 10 minutiga ning halda kogu müüki ühest lihtsast keskkonnast.',
  socialTitle: 'Poeruum – sinu e-pood 10 minutiga',
  socialDescription: 'Loo oma professionaalne e-pood lihtsalt ja kiiresti.',
}

describe('homepage SEO validation', () => {
  it('accepts valid homepage metadata', () => {
    expect(getHomepageSeoValidationError(validSeo)).toBeNull()
  })

  it('rejects titles and descriptions outside database limits', () => {
    expect(getHomepageSeoValidationError({ ...validSeo, seoTitle: 'Lühike' }))
      .toBe('Google’i pealkiri peab olema 10–70 tähemärki.')
    expect(getHomepageSeoValidationError({ ...validSeo, socialDescription: 'Liiga lühike' }))
      .toBe('Sotsiaalmeedia kirjeldus peab olema 20–200 tähemärki.')
  })

  it('does not count a Unicode surrogate pair twice', () => {
    expect(seoTextLength('Pood 🛍')).toBe(6)
  })
})
