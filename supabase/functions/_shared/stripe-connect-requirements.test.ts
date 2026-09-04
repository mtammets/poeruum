import { describe, expect, it } from 'vitest'
import { summarizeStripeRequirements } from './stripe-connect-requirements.ts'

describe('summarizeStripeRequirements', () => {
  it('combines current and future requirements without double counting', () => {
    expect(summarizeStripeRequirements({
      requirements: {
        currently_due: ['representative.verification.document', 'company.tax_id'],
        past_due: ['company.tax_id'],
        current_deadline: 1_791_504_000,
        errors: [{
          code: 'verification_document_address_mismatch',
          requirement: 'company.verification.document',
        }],
      },
      future_requirements: {
        currently_due: ['representative.verification.document'],
        current_deadline: 1_791_590_400,
        errors: [{
          code: 'verification_document_address_mismatch',
          requirement: 'company.verification.document',
        }],
      },
    })).toEqual({
      dueCount: 2,
      pastDue: true,
      currentDeadline: '2026-10-09T00:00:00.000Z',
      pendingVerification: false,
      disabledReason: null,
      issues: [{
        code: 'verification_document_address_mismatch',
        requirement: 'company.verification.document',
      }],
    })
  })

  it('reports verification in progress without creating an action', () => {
    expect(summarizeStripeRequirements({
      requirements: { pending_verification: ['representative.verification.document'] },
    })).toEqual({
      dueCount: 0,
      pastDue: false,
      currentDeadline: null,
      pendingVerification: true,
      disabledReason: null,
      issues: [],
    })
  })

  it('discards malformed Stripe error data before it reaches the merchant record', () => {
    expect(summarizeStripeRequirements({
      requirements: {
        currently_due: ['company.verification.document'],
        errors: [
          { code: 'verification_document_expired', requirement: 'company.verification.document' },
          { code: 'Not safe!', requirement: 'company.verification.document' },
        ],
      },
    }).issues).toEqual([
      { code: 'verification_document_expired', requirement: 'company.verification.document' },
    ])
  })
})
