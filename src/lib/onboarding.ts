import type { StoreRecord } from './database'

export type OnboardingStep = 'store' | 'business' | 'payments' | 'shipping' | 'product' | 'publish' | 'complete'
export type StoreDestination = Exclude<OnboardingStep, 'complete'> | 'storefront'

const onboardingSteps = new Set<OnboardingStep>(['store', 'business', 'payments', 'shipping', 'product', 'publish', 'complete'])

export const getStoreDestination = (store: StoreRecord, productCount?: number): StoreDestination => {
  if (store.is_published) return 'storefront'

  const settings = store.settings as Record<string, unknown>
  const savedStep = settings.onboardingStep
  if (typeof savedStep === 'string' && onboardingSteps.has(savedStep as OnboardingStep) && savedStep !== 'complete') {
    if (savedStep === 'publish' && productCount === 0) return 'product'
    return savedStep as StoreDestination
  }

  // Older drafts do not have an onboarding step yet. Infer the first
  // unfinished screen once, then persist an explicit step on the next save.
  const hasSellerDetails = Boolean(
    String(settings.businessName ?? '').trim()
    && /^\d{8}$/.test(String(settings.registryCode ?? '').trim())
    && String(settings.businessAddress ?? '').trim()
    && String(settings.contactEmail ?? '').trim(),
  )
  if (!hasSellerDetails) return 'business'
  if (store.payment_status === 'idle') return 'payments'
  if (!store.shipping.length) return 'shipping'
  if (productCount === 0) return 'product'
  return 'publish'
}
