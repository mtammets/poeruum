import { describe, expect, it } from 'vitest'
import {
  formatStripeRequirementDeadline,
  stripeRequirementsFromStore,
  stripeRequirementsNeedAction,
} from './stripeRequirements'

describe('Stripe requirement summaries', () => {
  it('marks due information as requiring merchant action', () => {
    expect(stripeRequirementsNeedAction({
      dueCount: 2,
      pastDue: false,
      currentDeadline: '2026-10-09T00:00:00.000Z',
      pendingVerification: false,
      disabledReason: null,
    })).toBe(true)
  })

  it('does not ask for more information while submitted details are only being verified', () => {
    expect(stripeRequirementsNeedAction({
      dueCount: 0,
      pastDue: false,
      currentDeadline: null,
      pendingVerification: true,
      disabledReason: null,
    })).toBe(false)
  })

  it('surfaces a capability restriction even when Stripe has no field count', () => {
    expect(stripeRequirementsNeedAction({
      dueCount: 0,
      pastDue: false,
      currentDeadline: null,
      pendingVerification: false,
      disabledReason: 'requirements.past_due',
    })).toBe(true)
  })

  it('normalizes missing database values and formats the Estonian deadline', () => {
    expect(stripeRequirementsFromStore({})).toEqual({
      dueCount: 0,
      pastDue: false,
      currentDeadline: null,
      pendingVerification: false,
      disabledReason: null,
    })
    expect(formatStripeRequirementDeadline('2026-10-09T00:00:00.000Z')).toBe('09.10.2026')
    expect(formatStripeRequirementDeadline('not-a-date')).toBeNull()
  })
})
