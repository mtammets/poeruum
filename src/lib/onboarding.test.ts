import { describe, expect, it } from 'vitest'
import type { StoreRecord } from './database'
import { getStoreDestination } from './onboarding'

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
