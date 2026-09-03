import { describe, expect, it } from 'vitest'
import type { StoreRecord } from './database'
import { getPaymentSetupState, getStoreDestination, getStripeSetupMode } from './onboarding'

const readyDraft = (settings: Record<string, unknown> = {}) => ({
  is_published: false,
  payment_status: 'connected',
  shipping: ['pickup'],
  settings: {
    businessName: 'Test OÜ',
    registryCode: '12345678',
    businessAddress: 'Test 1, Tallinn',
    contactEmail: 'merchant@example.invalid',
    ...settings,
  },
}) as unknown as StoreRecord

describe('getStoreDestination', () => {
  it('keeps published stores in the merchant storefront', () => {
    expect(getStoreDestination({ ...readyDraft(), is_published: true }, 0)).toBe('storefront')
  })

  it('routes an old publish step without products back to the product step', () => {
    expect(getStoreDestination(readyDraft({ onboardingStep: 'publish' }), 0)).toBe('product')
  })

  it('resumes the product step after a product has been saved', () => {
    expect(getStoreDestination(readyDraft({ onboardingStep: 'product' }), 1)).toBe('product')
  })

  it('infers the product step for a ready legacy draft without products', () => {
    expect(getStoreDestination(readyDraft(), 0)).toBe('product')
  })

  it('allows a ready draft with a product to continue to publication', () => {
    expect(getStoreDestination(readyDraft(), 1)).toBe('publish')
  })
})

describe('getPaymentSetupState', () => {
  const requirements = {
    dueCount: 0,
    pastDue: false,
    currentDeadline: null,
    pendingVerification: true,
    disabledReason: 'requirements.pending_verification',
  }

  it('lets setup continue while Stripe verifies already submitted details', () => {
    expect(getPaymentSetupState('pending', true, requirements)).toBe('reviewing')
  })

  it('keeps the merchant in Stripe when information is still due', () => {
    expect(getPaymentSetupState('pending', true, { ...requirements, dueCount: 1 })).toBe('setup-required')
  })

  it('does not treat an unsynchronized pending state as completed setup', () => {
    expect(getPaymentSetupState('pending', true, null)).toBe('setup-required')
    expect(getPaymentSetupState('pending', false, requirements)).toBe('setup-required')
    expect(getPaymentSetupState('pending', true, { ...requirements, pendingVerification: false, disabledReason: null }))
      .toBe('setup-required')
  })

  it('recognizes an activated Stripe account', () => {
    expect(getPaymentSetupState('connected', true, null)).toBe('connected')
    expect(getPaymentSetupState('connected', false, null)).toBe('setup-required')
  })
})

describe('getStripeSetupMode', () => {
  const dueRequirements = {
    dueCount: 1,
    pastDue: false,
    currentDeadline: null,
    pendingVerification: false,
    disabledReason: null,
  }

  it('starts or resumes first-time onboarding with payout account collection', () => {
    expect(getStripeSetupMode(false, 'onboarding', undefined, null)).toBe('onboarding')
    expect(getStripeSetupMode(true, 'onboarding', false, dueRequirements)).toBe('onboarding')
  })

  it('uses authenticated management when submitted onboarding later needs changes', () => {
    expect(getStripeSetupMode(true, 'onboarding', true, dueRequirements)).toBe('management')
  })

  it('keeps explicit compliance links in focused remediation', () => {
    expect(getStripeSetupMode(true, 'requirements', true, dueRequirements)).toBe('remediation')
  })

  it('keeps completed accounts in authenticated management', () => {
    expect(getStripeSetupMode(true, 'management', true, null)).toBe('management')
  })
})
