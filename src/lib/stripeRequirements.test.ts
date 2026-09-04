import { describe, expect, it } from 'vitest'
import {
  formatStripeRequirementDeadline,
  stripeRequirementIssueCopies,
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
      issues: [],
    })).toBe(true)
  })

  it('does not ask for more information while submitted details are only being verified', () => {
    expect(stripeRequirementsNeedAction({
      dueCount: 0,
      pastDue: false,
      currentDeadline: null,
      pendingVerification: true,
      disabledReason: null,
      issues: [],
    })).toBe(false)
  })

  it('surfaces a capability restriction even when Stripe has no field count', () => {
    expect(stripeRequirementsNeedAction({
      dueCount: 0,
      pastDue: false,
      currentDeadline: null,
      pendingVerification: false,
      disabledReason: 'requirements.past_due',
      issues: [],
    })).toBe(true)
  })

  it('normalizes missing database values and formats the Estonian deadline', () => {
    expect(stripeRequirementsFromStore({})).toEqual({
      dueCount: 0,
      pastDue: false,
      currentDeadline: null,
      pendingVerification: false,
      disabledReason: null,
      issues: [],
    })
    expect(formatStripeRequirementDeadline('2026-10-09T00:00:00.000Z')).toBe('09.10.2026')
    expect(formatStripeRequirementDeadline('not-a-date')).toBeNull()
  })

  it('normalizes stored issues and explains a document address mismatch in Estonian', () => {
    const requirements = stripeRequirementsFromStore({
      stripe_account_requirement_issues: [
        {
          code: 'verification_document_address_mismatch',
          requirement: 'company.verification.document',
        },
        { code: 'Unsafe code!', requirement: 'company.verification.document' },
      ],
    })

    expect(requirements.issues).toEqual([{
      code: 'verification_document_address_mismatch',
      requirement: 'company.verification.document',
    }])
    expect(stripeRequirementIssueCopies(requirements)).toEqual([{
      title: 'Dokumendil olev aadress ei ühti ettevõtte aadressiga',
      detail: 'Kontrolli, et Stripe’i kontol ja üles laaditud kehtival dokumendil oleks täpselt sama ettevõtte aadress.',
    }])
  })

  it('gives an actionable fallback for a future Stripe error code', () => {
    const [message] = stripeRequirementIssueCopies({
      dueCount: 1,
      pastDue: false,
      currentDeadline: null,
      pendingVerification: false,
      disabledReason: null,
      issues: [{ code: 'future_stripe_code', requirement: 'company.address.line1' }],
    })
    expect(message.title).toBe('Ettevõtte aadress vajab parandamist')
    expect(message.detail).toContain('Ava Stripe’i vorm')
  })

  it('does not repeat the same explanation for several Stripe fields', () => {
    const messages = stripeRequirementIssueCopies({
      dueCount: 2,
      pastDue: true,
      currentDeadline: null,
      pendingVerification: false,
      disabledReason: 'requirements.past_due',
      issues: [
        { code: 'verification_missing_directors', requirement: 'directors.first_name' },
        { code: 'verification_missing_directors', requirement: 'directors.last_name' },
      ],
    })
    expect(messages).toEqual([{
      title: 'Ettevõtte juhtide andmed on puudu',
      detail: 'Lisa Stripe’i vormis ettevõtte registrijärgsed juhid ja nende küsitud andmed.',
    }])
  })
})
