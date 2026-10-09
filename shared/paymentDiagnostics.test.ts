import { describe, expect, it } from 'vitest'
import { paymentExplanation, requirementGroups, safeRequirementFields, type PaymentDiagnostics } from './paymentDiagnostics'

const diagnostic = (changes: Partial<PaymentDiagnostics> = {}): PaymentDiagnostics => ({
  version: 1, userId: 'user', storeId: 'store', source: 'stripe', checkedAt: '2026-10-09T05:00:00Z', connected: true,
  mode: 'live', chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false,
  identityError: null, setupError: null, disabledReason: 'requirements.past_due', pendingVerification: false,
  dueCount: 0, dueFields: [], pendingFields: [], futureFields: [], deadline: null, issues: [], dashboardUrl: null, ...changes,
})

describe('admin payment reasons', () => {
  it('explains incomplete onboarding even when Stripe reports no verification errors', () => {
    const d = diagnostic({ dueCount: 6, dueFields: ['company.name', 'company.address.city', 'owners.first_name', 'owners.last_name', 'external_account', 'tos_acceptance.date'] })
    expect(paymentExplanation(d).title).toBe('Stripe’i seadistus pooleli')
    expect(requirementGroups(d.dueFields)).toEqual([
      { title: 'Ettevõte', fields: ['aadress', 'nimi'] }, { title: 'Pangakonto', fields: ['väljamaksete pangakonto'] },
      { title: 'Omanikud', fields: ['nimi'] }, { title: 'Tingimused', fields: ['Stripe’i tingimustega nõustumine'] },
    ])
  })
  it('keeps separate people and unknown requirements while grouping date and address parts', () => {
    const groups = requirementGroups(['person_ABC.dob.day', 'person_ABC.dob.month', 'person_ABC.dob.year', 'person_XYZ.email', 'new_provider_rule'])
    expect(groups).toContainEqual({ title: 'Isik 1', fields: ['sünnikuupäev'] })
    expect(groups).toContainEqual({ title: 'Isik 2', fields: ['e-post'] })
    expect(groups).toContainEqual({ title: 'Muud andmed', fields: ['new_provider_rule'] })
    expect(safeRequirementFields(['company.name', '<script>', 'Email:private@example.com', null, 'company.name'])).toEqual(['company.name'])
  })
  it('distinguishes pending verification from fields requiring action', () => {
    const d = diagnostic({ detailsSubmitted: true, pendingVerification: true, disabledReason: 'requirements.pending_verification' })
    expect(paymentExplanation(d)).toMatchObject({ title: 'Stripe kontrollib andmeid', tone: 'neutral' })
    expect(paymentExplanation({ ...d, dueCount: 1, dueFields: ['external_account'] }).title).toBe('Pangakonto puudu')
  })
  it('shows specific document, identity and rejection reasons', () => {
    expect(paymentExplanation(diagnostic({ issues: [{ code: 'verification_document_expired', requirement: 'individual.verification.document' }] })).title).toBe('Üles laaditud dokument on aegunud')
    expect(paymentExplanation(diagnostic({ disabledReason: null, identityError: 'Stripe’i konto omaniku nimi peab ühtima müüja nimega.' })).title).toBe('Müüja nimi ei ühti')
    expect(paymentExplanation(diagnostic({ disabledReason: 'rejected.terms_of_service' })).title).toBe('Stripe’i konto tagasi lükatud')
  })
  it('never infers a precise reason or healthy status from absent diagnostics', () => {
    expect(paymentExplanation(null, { state: 'restricted', issues: [] }).title).toBe('Põhjus kontrollimata')
    expect(paymentExplanation(diagnostic({ detailsSubmitted: true, disabledReason: null })).title).toBe('Põhjus täpsustamata')
    expect(paymentExplanation(diagnostic({ source: 'saved', dueCount: 30, dueFields: null })).title).toBe('Stripe’i seadistus pooleli')
  })
  it('does not claim that future requirements already disable an active account', () => {
    expect(paymentExplanation(diagnostic({ detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true, disabledReason: null, futureFields: ['company.tax_id'] })).title).toBe('Aktiivne')
    expect(paymentExplanation(diagnostic({ mode: 'test', chargesEnabled: true, payoutsEnabled: true })).title).toBe('Testrežiim')
  })
  it('requires transfers and a verified saved state before calling payments active', () => {
    const active = diagnostic({ detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true, disabledReason: null })
    expect(paymentExplanation({ ...active, transfersStatus: 'inactive' }).title).toBe('Ülekanded aktiveerimata')
    expect(paymentExplanation({ ...active, transfersStatus: 'pending' }).title).toBe('Ülekanded ootel')
    expect(paymentExplanation({ ...active, source: 'saved' }, { state: 'unknown' }).title).toBe('Valmisolek kontrollimata')
    expect(paymentExplanation({ ...active, source: 'saved' }, { state: 'active' }).title).toBe('Aktiivne')
  })
})
