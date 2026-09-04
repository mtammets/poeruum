export type StripeRequirementEmailKind =
  | 'action_required'
  | 'deadline_7d'
  | 'deadline_1d'
  | 'past_due'
  | 'disabled'

export type StripeRequirementEmailState = {
  dueCount?: number | null
  pastDue?: boolean | null
  pendingVerification?: boolean | null
  disabledReason?: string | null
  issues?: unknown
}

export type StripeRequirementEmailInput = {
  kind: StripeRequirementEmailKind
  storeName: string
  deadline?: string | null
  actionUrl?: string
  preview?: boolean
  requirements: StripeRequirementEmailState
}

export type RenderedStripeRequirementEmail = {
  subject: string
  html: string
  text: string
}

export const STRIPE_REQUIREMENT_ACTION_URL: 'https://poeruum.ee/?stripe_requirements=1'
export const STRIPE_REQUIREMENT_EMAIL_KINDS: readonly StripeRequirementEmailKind[]
export const stripeRequirementEmailNeedsAction: (requirements?: StripeRequirementEmailState) => boolean
export const renderStripeRequirementEmail: (input: StripeRequirementEmailInput) => RenderedStripeRequirementEmail | null
