import type { StoreRecord } from './database'
import { stripeRequirementsNeedAction, type StripeRequirementSummary } from './stripeRequirements'

export type OnboardingStep = 'store' | 'business' | 'payments' | 'shipping' | 'product' | 'publish' | 'complete'
export type StoreDestination = Exclude<OnboardingStep, 'complete'> | 'storefront'

const onboardingSteps = new Set<OnboardingStep>(['store', 'business', 'payments', 'shipping', 'product', 'publish', 'complete'])

export type PaymentSetupState = 'setup-required' | 'reviewing' | 'connected'
export type StripeSetupPurpose = 'onboarding' | 'requirements' | 'management'
export type StripeSetupMode = 'onboarding' | 'remediation' | 'management'

export const getPaymentSetupState = (
  paymentStatus: StoreRecord['payment_status'],
  hasStripeAccount: boolean,
  requirements?: StripeRequirementSummary | null,
): PaymentSetupState => {
  if (paymentStatus === 'connected' && hasStripeAccount) return 'connected'

  // Stripe can keep charges and payouts disabled while submitted KYC details
  // are being reviewed. That is Stripe work, not another merchant setup step.
  if (paymentStatus === 'pending' && hasStripeAccount && requirements?.pendingVerification
    && !stripeRequirementsNeedAction(requirements)) {
    return 'reviewing'
  }

  return 'setup-required'
}

export const getStripeSetupMode = (
  hasStripeAccount: boolean,
  purpose: StripeSetupPurpose | undefined,
  detailsSubmitted: boolean | undefined,
  requirements?: StripeRequirementSummary | null,
): StripeSetupMode => {
  if (!hasStripeAccount || (purpose === 'onboarding' && detailsSubmitted === false)) return 'onboarding'
  if (purpose === 'onboarding' && detailsSubmitted === true) return 'management'
  if (purpose === 'requirements' || stripeRequirementsNeedAction(requirements)) return 'remediation'
  return 'management'
}

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
