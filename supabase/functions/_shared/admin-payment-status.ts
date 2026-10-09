import type Stripe from 'npm:stripe@^22'
import { normalizeStripeRequirementIssues } from './stripe-requirement-issues.mjs'
import { stripeSellerIdentityError, existingStripeAccountError } from './stripe-oauth.ts'
import { safeRequirementFields, type PaymentDiagnostics } from '../../../shared/paymentDiagnostics.ts'

export const paymentStoreFields = 'id,owner_id,settings,payment_provider,stripe_account_id,stripe_account_mode,stripe_connection_type,stripe_account_charges_enabled,stripe_account_payouts_enabled,stripe_account_requirements_due_count,stripe_account_requirements_pending_verification,stripe_account_requirements_disabled_reason,stripe_account_requirements_deadline,stripe_account_requirements_updated_at,stripe_account_requirement_issues'
export type PaymentStore = {
  id: string; owner_id: string; settings: Record<string, unknown>; payment_provider: string | null
  stripe_account_id: string | null; stripe_account_mode: 'live' | 'test' | null; stripe_connection_type: string | null
  stripe_account_charges_enabled: boolean | null; stripe_account_payouts_enabled: boolean | null
  stripe_account_requirements_due_count: number; stripe_account_requirements_pending_verification: boolean
  stripe_account_requirements_disabled_reason: string | null; stripe_account_requirements_deadline: string | null
  stripe_account_requirements_updated_at: string | null; stripe_account_requirement_issues: unknown
}
export type PaymentCheck = { store_id: string; account_id: string; stripe_mode: string; identity: unknown; identity_error: string | null; checked_at: string }

// Match the existing SQL seller_identity_key; account changes invalidate checks.
export function matchingPaymentCheck(store: PaymentStore, checks: PaymentCheck[]) {
  const normalized = (value: unknown, lower = true) => typeof value === 'string' ? lower ? value.trim().toLowerCase() : value.trim() : null
  const s = store.settings
  const identity = s.sellerType === 'entrepreneur'
    ? ['entrepreneur', normalized(s.sellerFirstName), normalized(s.sellerLastName)]
    : ['company', normalized(s.businessName), normalized(s.registryCode, false)]
  return checks.find((check) => check.store_id === store.id && check.account_id === store.stripe_account_id
    && check.stripe_mode === store.stripe_account_mode && JSON.stringify(check.identity) === JSON.stringify(identity))
}

export function savedPaymentDiagnostics(store: PaymentStore, check?: PaymentCheck): PaymentDiagnostics {
  const connected = store.payment_provider === 'stripe' && Boolean(store.stripe_account_id)
  return {
    version: 1, userId: store.owner_id, storeId: store.id, source: 'saved',
    checkedAt: store.stripe_account_requirements_updated_at || check?.checked_at || null,
    connected, mode: store.stripe_account_mode,
    chargesEnabled: connected ? store.stripe_account_charges_enabled : null,
    payoutsEnabled: connected ? store.stripe_account_payouts_enabled : null,
    detailsSubmitted: null, identityError: check?.identity_error ?? null, setupError: null,
    disabledReason: store.stripe_account_requirements_disabled_reason,
    pendingVerification: store.stripe_account_requirements_pending_verification === true,
    dueCount: Math.max(0, Number(store.stripe_account_requirements_due_count) || 0),
    dueFields: null, pendingFields: null, futureFields: null,
    deadline: store.stripe_account_requirements_deadline,
    issues: normalizeStripeRequirementIssues(store.stripe_account_requirement_issues),
    dashboardUrl: connected && /^acct_[a-zA-Z0-9]+$/.test(store.stripe_account_id!)
      ? `https://dashboard.stripe.com/${store.stripe_account_mode === 'test' ? 'test/' : ''}connect/accounts/${store.stripe_account_id}` : null,
  }
}

export function livePaymentDiagnostics(store: PaymentStore, account: Stripe.Account, now = new Date()): PaymentDiagnostics {
  const due = safeRequirementFields([...(account.requirements?.currently_due ?? []), ...(account.requirements?.past_due ?? [])])
  const pending = safeRequirementFields(account.requirements?.pending_verification)
  const future = safeRequirementFields([...(account.future_requirements?.currently_due ?? []), ...(account.future_requirements?.past_due ?? [])]).filter((field) => !due.includes(field))
  return {
    ...savedPaymentDiagnostics(store), source: 'stripe', checkedAt: now.toISOString(),
    chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled,
    transfersStatus: account.capabilities?.transfers ?? 'unrequested',
    detailsSubmitted: account.details_submitted,
    identityError: store.stripe_connection_type === 'oauth'
      ? existingStripeAccountError(account, store.settings) : stripeSellerIdentityError(account, store.settings),
    disabledReason: account.requirements?.disabled_reason ?? null,
    pendingVerification: pending.length > 0,
    dueCount: due.length, dueFields: due, pendingFields: pending, futureFields: future,
    deadline: account.requirements?.current_deadline ? new Date(account.requirements.current_deadline * 1000).toISOString() : null,
    issues: normalizeStripeRequirementIssues(account.requirements?.errors),
  }
}
