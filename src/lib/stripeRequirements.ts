export type StripeRequirementSummary = {
  dueCount: number
  pastDue: boolean
  currentDeadline: string | null
  pendingVerification: boolean
  disabledReason: string | null
}

type StripeRequirementStoreFields = {
  stripe_account_requirements_due_count?: number | null
  stripe_account_requirements_past_due?: boolean | null
  stripe_account_requirements_deadline?: string | null
  stripe_account_requirements_pending_verification?: boolean | null
  stripe_account_requirements_disabled_reason?: string | null
}

export const stripeRequirementsFromStore = (store: StripeRequirementStoreFields): StripeRequirementSummary => ({
  dueCount: Math.max(0, Number(store.stripe_account_requirements_due_count) || 0),
  pastDue: store.stripe_account_requirements_past_due === true,
  currentDeadline: typeof store.stripe_account_requirements_deadline === 'string'
    ? store.stripe_account_requirements_deadline
    : null,
  pendingVerification: store.stripe_account_requirements_pending_verification === true,
  disabledReason: typeof store.stripe_account_requirements_disabled_reason === 'string'
    ? store.stripe_account_requirements_disabled_reason
    : null,
})

export const stripeRequirementsNeedAction = (requirements?: StripeRequirementSummary | null) =>
  Boolean(requirements && (
    requirements.dueCount > 0
    || requirements.pastDue
    || (requirements.disabledReason && !requirements.pendingVerification)
  ))

export const formatStripeRequirementDeadline = (deadline?: string | null) => {
  if (!deadline) return null
  const date = new Date(deadline)
  if (!Number.isFinite(date.getTime())) return null
  return date.toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
