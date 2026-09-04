export type StripeRequirementIssue = {
  code: string
  requirement: string | null
}

export type StripeRequirementIssueCopy = {
  title: string
  detail: string
}

export const normalizeStripeRequirementIssues: (value: unknown) => StripeRequirementIssue[]
export const getStripeRequirementIssueCopy: (issue: unknown) => StripeRequirementIssueCopy | null
export const getStripeRequirementIssueCopies: (issues: unknown) => StripeRequirementIssueCopy[]
