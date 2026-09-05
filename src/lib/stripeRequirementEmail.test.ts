import { describe, expect, it } from 'vitest'
import {
  STRIPE_REQUIREMENT_ACTION_URL,
  renderStripeRequirementEmail,
  stripeRequirementEmailNeedsAction,
  type StripeRequirementEmailKind,
} from '../../supabase/functions/_shared/stripe-requirement-email.mjs'

const actionRequired = {
  dueCount: 1,
  pastDue: false,
  pendingVerification: false,
  disabledReason: null,
  issues: [],
}

const render = (kind: StripeRequirementEmailKind = 'action_required') => renderStripeRequirementEmail({
  kind,
  storeName: 'Kera Kodustuudio',
  deadline: '2026-10-09T00:00:00.000Z',
  requirements: kind === 'past_due'
    ? { ...actionRequired, pastDue: true }
    : kind === 'disabled'
      ? { ...actionRequired, disabledReason: 'requirements.past_due' }
      : actionRequired,
})

describe('Stripe requirement email renderer', () => {
  it('renders every action and escalation kind with the in-Poeruum CTA', () => {
    const expected = new Map<StripeRequirementEmailKind, string>([
      ['action_required', 'Maksete jätkamiseks kinnita ettevõtte andmed'],
      ['deadline_7d', 'Ettevõtte andmete kinnitamiseks on jäänud 7 päeva'],
      ['deadline_1d', 'Ettevõtte andmete kinnitamiseks on jäänud 1 päev'],
      ['past_due', 'Ettevõtte andmete kinnitamise tähtaeg on möödas'],
      ['disabled', 'Maksekonto piirangu lahendamiseks kinnita ettevõtte andmed'],
    ])

    for (const [kind, title] of expected) {
      const email = render(kind)
      expect(email).not.toBeNull()
      expect(email?.html).toContain(title)
      expect(email?.html).toContain(`href="${STRIPE_REQUIREMENT_ACTION_URL.replace('&', '&amp;')}"`)
      expect(email?.text).toContain(`${STRIPE_REQUIREMENT_ACTION_URL}`)
      expect(email?.html).toContain('Stripe on Poeruumi maksepartner')
      expect(email?.html).toContain('maksta kaardi, Apple Pay või Google Payga')
      expect(email?.html).toContain('Et maksed oleksid turvalised ja vastaksid seadustele')
      expect(email?.html).toContain('andmed saadetakse otse Stripe’ile')
      expect(email?.text).toContain('Poeruum ei näe ega salvesta sinu isikut tõendava dokumendi sisu')
    }
  })

  it('does not render an action email while Stripe is only reviewing submitted information', () => {
    const pendingOnly = {
      dueCount: 0,
      pastDue: false,
      pendingVerification: true,
      disabledReason: null,
      issues: [],
    }
    expect(stripeRequirementEmailNeedsAction(pendingOnly)).toBe(false)
    expect(renderStripeRequirementEmail({
      kind: 'action_required',
      storeName: 'Kontrollimisel pood',
      requirements: pendingOnly,
    })).toBeNull()
  })

  it('uses grammatical Estonian deadline forms and a safe fallback when the date is invalid', () => {
    expect(render()?.subject).toBe('Kinnita ettevõtte andmed enne 9. oktoobrit 2026 · Kera Kodustuudio')
    expect(render()?.text).toContain('hiljemalt 9. oktoobriks 2026')
    expect(render()?.text).not.toContain('9. oktoobril 2026')
    const fallback = renderStripeRequirementEmail({
      kind: 'action_required',
      storeName: 'Kera Kodustuudio',
      deadline: 'not-a-date',
      requirements: actionRequired,
    })
    expect(fallback?.subject).toBe('Kinnita ettevõtte andmed · Kera Kodustuudio')
    expect(fallback?.text).toContain('esimesel võimalusel')
  })

  it('tells the merchant the concrete Stripe issue without exposing raw provider text', () => {
    const email = renderStripeRequirementEmail({
      kind: 'disabled',
      storeName: 'VeidradAsjad',
      requirements: {
        ...actionRequired,
        disabledReason: 'requirements.past_due',
        issues: [{
          code: 'verification_document_address_mismatch',
          requirement: 'company.verification.document',
        }],
      },
    })

    expect(email?.html).toContain('Mida tuleb parandada')
    expect(email?.html).toContain('Dokumendil olev aadress ei ühti ettevõtte aadressiga')
    expect(email?.text).toContain('Kontrolli, et Stripe’i kontol ja üles laaditud kehtival dokumendil oleks täpselt sama ettevõtte aadress.')
    expect(email?.text).not.toContain('verification_document_address_mismatch')
  })

  it('preserves separate home and company address guidance in both email formats', () => {
    const email = renderStripeRequirementEmail({
      kind: 'action_required',
      storeName: 'Kera Kodustuudio',
      requirements: {
        ...actionRequired,
        issues: [
          { code: 'verification_document_address_mismatch', requirement: 'person_example.verification.additional_document' },
          { code: 'verification_document_address_mismatch', requirement: 'company.verification.document' },
        ],
      },
    })

    for (const body of [email?.html, email?.text]) {
      expect(body).toContain('Dokumendil olev aadress ei ühti elukoha aadressiga')
      expect(body).toContain('Ettevõtte aadress võib sellest erineda')
      expect(body).toContain('Dokumendil olev aadress ei ühti ettevõtte aadressiga')
      expect(body).not.toContain('person_example')
    }
  })

  it('escapes merchant-controlled content and removes subject header characters', () => {
    const email = renderStripeRequirementEmail({
      kind: 'action_required',
      storeName: 'Pood\r\nBcc: ohver@example.com <script>alert(1)</script>',
      requirements: actionRequired,
    })
    expect(email?.subject).not.toContain('\r')
    expect(email?.subject).not.toContain('\n')
    expect(email?.html).not.toContain('<script>alert(1)</script>')
    expect(email?.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('rejects links outside Poeruum', () => {
    expect(() => renderStripeRequirementEmail({
      kind: 'action_required',
      storeName: 'Kera Kodustuudio',
      actionUrl: 'https://poeruum.ee.attacker.example/?stripe_requirements=1',
      requirements: actionRequired,
    })).toThrow(/poeruum\.ee/)
  })

  it('marks previews clearly and includes a security warning in HTML and text', () => {
    const email = renderStripeRequirementEmail({
      kind: 'action_required',
      storeName: 'Poeruumi testpood',
      deadline: '2026-10-09T00:00:00.000Z',
      preview: true,
      requirements: actionRequired,
    })
    expect(email?.subject).toMatch(/^\[Eelvaade\]/)
    expect(email?.html).toContain('fiktiivse poe andmetega')
    expect(email?.html).toContain('Ära vasta sellele kirjale isikut tõendava dokumendi')
    expect(email?.text).toContain('Smart-ID või PIN-koodidega')
  })
})
