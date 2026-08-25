type StripeRequirementSet = {
  current_deadline?: number | null
  currently_due?: string[] | null
  past_due?: string[] | null
  pending_verification?: string[] | null
  disabled_reason?: string | null
}

type StripeAccountWithRequirements = {
  requirements?: StripeRequirementSet | null
  future_requirements?: StripeRequirementSet | null
}

export type StripeRequirementSummary = {
  dueCount: number
  pastDue: boolean
  currentDeadline: string | null
  pendingVerification: boolean
  disabledReason: string | null
}

const uniqueRequirementNames = (...lists: Array<string[] | null | undefined>) =>
  new Set(lists.flatMap((list) => Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item.length > 0) : []))

const earliestDeadline = (...deadlines: Array<number | null | undefined>) => {
  const timestamps = deadlines.filter((deadline): deadline is number =>
    typeof deadline === 'number' && Number.isFinite(deadline) && deadline > 0)
  if (!timestamps.length) return null
  return new Date(Math.min(...timestamps) * 1000).toISOString()
}

export const summarizeStripeRequirements = (account: StripeAccountWithRequirements): StripeRequirementSummary => {
  const current = account.requirements
  const future = account.future_requirements
  const currentlyDue = uniqueRequirementNames(current?.currently_due, future?.currently_due)
  const pastDue = uniqueRequirementNames(current?.past_due, future?.past_due)
  const allDue = new Set([...currentlyDue, ...pastDue])
  const pendingVerification = uniqueRequirementNames(current?.pending_verification, future?.pending_verification)

  return {
    dueCount: allDue.size,
    pastDue: pastDue.size > 0,
    currentDeadline: earliestDeadline(current?.current_deadline, future?.current_deadline),
    pendingVerification: pendingVerification.size > 0,
    disabledReason: current?.disabled_reason ?? future?.disabled_reason ?? null,
  }
}

export const stripeRequirementStoreUpdate = (summary: StripeRequirementSummary) => ({
  stripe_account_requirements_due_count: summary.dueCount,
  stripe_account_requirements_past_due: summary.pastDue,
  stripe_account_requirements_deadline: summary.currentDeadline,
  stripe_account_requirements_pending_verification: summary.pendingVerification,
  stripe_account_requirements_disabled_reason: summary.disabledReason,
  stripe_account_requirements_updated_at: new Date().toISOString(),
})

export const emptyStripeRequirementStoreUpdate = () => stripeRequirementStoreUpdate({
  dueCount: 0,
  pastDue: false,
  currentDeadline: null,
  pendingVerification: false,
  disabledReason: null,
})
