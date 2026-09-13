import { describe, expect, it } from 'vitest'
import { getPasswordResetRedirectUrl, isPasswordRecoveryLocation } from './passwordRecovery'

describe('password recovery links', () => {
  it.each([
    'https://poeruum.ee/?reset_password=1',
    'https://poeruum.ee/#access_token=example&type=recovery',
    'https://pood.poeruum.ee/#type=recovery',
  ])('recognizes recovery before and after the SDK consumes %s', (href) => {
    expect(isPasswordRecoveryLocation(new URL(href))).toBe(true)
  })

  it.each([
    'https://poeruum.ee/#type=signup',
    'https://poeruum.ee/#type=magiclink',
    'https://poeruum.ee/#message=type=recovery',
    'https://poeruum.ee/?reset_password=0',
    'https://poeruum.ee/?continue_setup=1',
  ])('does not confuse another login intent with recovery: %s', (href) => {
    expect(isPasswordRecoveryLocation(new URL(href))).toBe(false)
  })

  it.each([
    'https://poeruum.ee/?billing=success',
    'https://www.poeruum.ee/',
    'https://pood.poeruum.ee/haldus?stripe_requirements=1',
    'https://minupood.ee/',
  ])('returns recovery to the allowed platform origin from %s', (href) => {
    expect(getPasswordResetRedirectUrl(new URL(href))).toBe('https://poeruum.ee/?reset_password=1')
  })

  it('keeps local recovery on the development server', () => {
    expect(getPasswordResetRedirectUrl(new URL('http://localhost:5173/p/test')))
      .toBe('http://localhost:5173/?reset_password=1')
  })
})
