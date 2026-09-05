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

  it.each([
    'person_example.verification.document',
    'person_example.verification.additional_document',
    'individual.verification.document',
    'representative.address.line1',
    'owners.address.line1',
  ])('explains the home address when the document belongs to a person: %s', (requirement) => {
    const [message] = stripeRequirementIssueCopies(stripeRequirementsFromStore({
      stripe_account_requirement_issues: [{ code: 'verification_document_address_mismatch', requirement }],
    }))
    expect(message.title).toBe('Dokumendil olev aadress ei ühti elukoha aadressiga')
    expect(message.detail).toContain('selle inimese tegelik elukoha aadress')
    expect(message.detail).toContain('Ettevõtte aadress võib sellest erineda')
  })

  it.each([null, '', 'unknown.verification.document', 'company_unknown.verification.document'])('does not guess whose address is being checked: %s', (requirement) => {
    const [message] = stripeRequirementIssueCopies(stripeRequirementsFromStore({
      stripe_account_requirement_issues: [{ code: 'verification_document_address_mismatch', requirement }],
    }))
    expect(message.title).toBe('Dokumendil olev aadress ei ühti sisestatud aadressiga')
    expect(message.detail).toContain('kelle aadressi kinnitatakse')
  })

  it.each([
    'verification_document_address_missing',
    'invalid_street_address',
    'invalid_address_city_state_postal_code',
  ])('keeps other address errors specific to the person or company: %s', (code) => {
    const messages = stripeRequirementIssueCopies(stripeRequirementsFromStore({
      stripe_account_requirement_issues: [
        { code, requirement: 'person_example.address.line1' },
        { code, requirement: 'company.address.line1' },
        { code, requirement: null },
      ],
    }))
    expect(messages).toHaveLength(3)
    expect(messages[0].detail).toContain('elukoha aadress')
    expect(messages[0].detail).not.toContain('ettevõtte')
    expect(messages[1].detail).toContain('ettevõtte')
    expect(messages[2].detail).not.toContain('elukoha')
  })

  it('keeps both explanations when Stripe flags personal and company documents', () => {
    const messages = stripeRequirementIssueCopies(stripeRequirementsFromStore({
      stripe_account_requirement_issues: [
        { code: 'verification_document_address_mismatch', requirement: 'person_example.verification.additional_document' },
        { code: 'verification_document_address_mismatch', requirement: 'company.verification.document' },
      ],
    }))
    expect(messages).toHaveLength(2)
    expect(messages[0].title).toContain('elukoha aadressiga')
    expect(messages[1].title).toContain('ettevõtte aadressiga')
  })

  it.each([
    ['company.address.line1', 'Ettevõtte aadress'],
    ['person_example.address.line1', 'Elukoha aadress'],
    ['individual.address.postal_code', 'Elukoha aadress'],
    ['unknown.address.line1', 'Sisestatud aadress'],
  ])('gives an actionable address fallback for a future error code: %s', (requirement, label) => {
    const [message] = stripeRequirementIssueCopies({
      dueCount: 1,
      pastDue: false,
      currentDeadline: null,
      pendingVerification: false,
      disabledReason: null,
      issues: [{ code: 'future_stripe_code', requirement }],
    })
    expect(message.title).toBe(`${label} vajab parandamist`)
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
