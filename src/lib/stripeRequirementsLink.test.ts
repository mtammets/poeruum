import { describe, expect, it } from 'vitest'
import {
  getStripeRequirementsLinkIntent,
  getStripeRequirementsStoreTarget,
  isStripeRequirementsLink,
  removeStripeRequirementsLinkParam,
} from './stripeRequirementsLink'

describe('Poeruum Stripe requirements links', () => {
  it('recognizes only the explicit root-page request', () => {
    expect(isStripeRequirementsLink({ pathname: '/', search: '?stripe_requirements=1' })).toBe(true)
    expect(isStripeRequirementsLink({ pathname: '/', search: '?stripe_requirements=0' })).toBe(false)
    expect(isStripeRequirementsLink({ pathname: '/', search: '?stripe_requirements=1&stripe_requirements=1' })).toBe(false)
    expect(isStripeRequirementsLink({ pathname: '/p/testipood/', search: '?stripe_requirements=1' })).toBe(false)
    expect(getStripeRequirementsLinkIntent({ pathname: '/', search: '' })).toBe('none')
    expect(getStripeRequirementsLinkIntent({ pathname: '/', search: '?stripe_requirements=0' })).toBe('invalid')
  })

  it('leaves legacy Stripe callbacks in control when query intents conflict', () => {
    expect(getStripeRequirementsLinkIntent({ pathname: '/', search: '?stripe_requirements=1&billing=success' }))
      .toBe('conflict')
    expect(getStripeRequirementsLinkIntent({ pathname: '/', search: '?stripe_requirements=1&stripe_connect=return' }))
      .toBe('conflict')
    expect(isStripeRequirementsLink({ pathname: '/', search: '?stripe_requirements=1&billing=success' }))
      .toBe(false)
  })

  it('removes only its own query parameter after routing', () => {
    expect(removeStripeRequirementsLinkParam('https://poeruum.ee/?utm_source=email&stripe_requirements=1#maksed'))
      .toBe('/?utm_source=email#maksed')
    expect(removeStripeRequirementsLinkParam('https://poeruum.ee/?stripe_requirements=1&billing=success'))
      .toBe('/?billing=success')
  })

  it('opens published stores in payment settings with embedded management', () => {
    expect(getStripeRequirementsStoreTarget({ isPublished: true, hasStripeAccount: true })).toEqual({
      screen: 'storefront',
      initialSettingsSection: 'payments',
      openEmbeddedManagement: true,
    })
  })

  it('uses the existing payment setup surface for draft stores', () => {
    expect(getStripeRequirementsStoreTarget({ isPublished: false, hasStripeAccount: true })).toEqual({
      screen: 'payments',
      initialSettingsSection: null,
      openEmbeddedManagement: true,
    })
    expect(getStripeRequirementsStoreTarget({ isPublished: true, hasStripeAccount: false }).openEmbeddedManagement)
      .toBe(false)
  })
})
