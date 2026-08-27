import { describe, expect, it } from 'vitest'
import {
  canPermanentlyDeleteLead,
  classifyContactEmail,
  contactMatchesWebsite,
  createLeadOutreachTemplate,
  leadPricingSentence,
  normalizeEmail,
  normalizePublicUrl,
  sourceKey,
  sourceMatches,
  validateLeadResearchCandidate,
  websiteDomain,
} from '../../supabase/functions/_shared/lead-utils'

describe('lead outreach public data safeguards', () => {
  it('allows permanent deletion only before a message has been sent', () => {
    expect(['new', 'ready', 'archived'].every(canPermanentlyDeleteLead)).toBe(true)
    expect(['sending', 'sent', 'replied', 'unsubscribed', 'bounced', 'complained'].some(canPermanentlyDeleteLead)).toBe(false)
  })

  it('allows known company mailboxes but rejects personal or unclear addresses', () => {
    expect(classifyContactEmail('info@ettevote.ee')).toBe('general_business')
    expect(classifyContactEmail('Tere.Pood@ettevote.ee')).toBe('general_business')
    expect(classifyContactEmail('mari@ettevote.ee')).toBe('personal_or_unclear')
    expect(classifyContactEmail('info@gmail.com')).toBe('personal_or_unclear')
    expect(classifyContactEmail('ettevote@gmail.com')).toBe('personal_or_unclear')
    expect(classifyContactEmail('not-an-email')).toBe('missing')
  })

  it('normalizes valid public addresses and removes tracking parameters', () => {
    expect(normalizeEmail(' INFO@ETTEVOTE.EE ')).toBe('info@ettevote.ee')
    expect(normalizePublicUrl('https://www.ettevote.ee/kontakt/?utm_source=test#email'))
      .toBe('https://www.ettevote.ee/kontakt/')
    expect(websiteDomain('https://www.ettevote.ee/tooted')).toBe('ettevote.ee')
    expect(normalizePublicUrl('http://localhost/contact')).toBeNull()
  })

  it('requires the exact contact source to appear in OpenAI web-search sources', () => {
    const source = sourceKey('https://ettevote.ee/kontakt/')
    const sources = new Set(source ? [source] : [])
    expect(sourceMatches('https://ettevote.ee/kontakt?utm_medium=email', sources)).toBe(true)
    expect(sourceMatches('https://ettevote.ee/meist', sources)).toBe(false)
    expect(sourceMatches('https://another.example/kontakt', sources)).toBe(false)
  })

  it('requires the mailbox and contact source to belong to the company website', () => {
    expect(contactMatchesWebsite('info@ettevote.ee', 'https://ettevote.ee', 'https://www.ettevote.ee/kontakt')).toBe(true)
    expect(contactMatchesWebsite('info@pood.ettevote.ee', 'https://ettevote.ee', 'https://pood.ettevote.ee/kontakt')).toBe(true)
    expect(contactMatchesWebsite('info@teine.ee', 'https://ettevote.ee', 'https://ettevote.ee/kontakt')).toBe(false)
    expect(contactMatchesWebsite('info@ettevote.ee', 'https://ettevote.ee', 'https://kataloog.ee/ettevote')).toBe(false)
  })

  it('accepts only complete research candidates backed by the returned web sources', () => {
    const sourceKeys = new Set([
      sourceKey('https://ettevote.ee/tooted'),
      sourceKey('https://ettevote.ee/kontakt'),
    ].filter((value): value is string => Boolean(value)))
    const candidate = {
      company_name: ' Näidis OÜ ',
      website_url: 'https://www.ettevote.ee/?utm_source=search',
      source_url: 'https://ettevote.ee/tooted',
      email_source_url: 'https://ettevote.ee/kontakt',
      contact_email: ' INFO@ETTEVOTE.EE ',
      location: 'Tallinn',
      segment: 'Käsitöö',
      summary: 'Ettevõte müüb enda valmistatud tooteid.',
      fit_reason: 'Tellimused võetakse praegu vastu käsitsi.',
      evidence: 'Toodete lehel puudub ostukorv.',
      fit_score: 99,
      draft_subject: 'Seda välja ei kasutata',
      draft_body: 'Seda välja ei kasutata',
    }

    expect(validateLeadResearchCandidate(candidate, sourceKeys)).toEqual({
      company_name: 'Näidis OÜ',
      website_url: 'https://www.ettevote.ee/',
      website_domain: 'ettevote.ee',
      source_url: 'https://ettevote.ee/tooted',
      email_source_url: 'https://ettevote.ee/kontakt',
      contact_email: 'info@ettevote.ee',
      contact_kind: 'general_business',
      location: 'Tallinn',
      segment: 'Käsitöö',
      summary: 'Ettevõte müüb enda valmistatud tooteid.',
      fit_reason: 'Tellimused võetakse praegu vastu käsitsi.',
      evidence: 'Toodete lehel puudub ostukorv.',
    })
  })

  it('rejects incomplete, personal, unrelated, or uncited research contacts', () => {
    const productSource = sourceKey('https://ettevote.ee/tooted')
    const contactSource = sourceKey('https://ettevote.ee/kontakt')
    const sourceKeys = new Set([productSource, contactSource].filter((value): value is string => Boolean(value)))
    const candidate = {
      company_name: 'Näidis OÜ',
      website_url: 'https://ettevote.ee',
      source_url: 'https://ettevote.ee/tooted',
      email_source_url: 'https://ettevote.ee/kontakt',
      contact_email: 'info@ettevote.ee',
      location: '',
      segment: 'Käsitöö',
      summary: 'Ettevõte müüb füüsilisi tooteid.',
      fit_reason: 'Tellimused toimuvad käsitsi.',
      evidence: 'Toodete lehel puudub ostukorv.',
    }

    expect(validateLeadResearchCandidate({ ...candidate, contact_email: 'mari@ettevote.ee' }, sourceKeys)).toBeNull()
    expect(validateLeadResearchCandidate({ ...candidate, contact_email: 'info@teine.ee' }, sourceKeys)).toBeNull()
    expect(validateLeadResearchCandidate(candidate, new Set(productSource ? [productSource] : []))).toBeNull()
    expect(validateLeadResearchCandidate({ ...candidate, evidence: '' }, sourceKeys)).toBeNull()
  })

  it('uses one approved outreach template instead of generated sales copy', () => {
    expect(createLeadOutreachTemplate()).toEqual({
      subject: 'Poeruum – e-pood telefonist',
      body: [
        'Tere!',
        'Leidsin teie ettevõtte ja mõtlesin, et Poeruum võib teile huvi pakkuda.',
        'Poeruum on e-poe loomise ja haldamise teenus. Poe saab üles seada umbes 10 minutiga ning tooteid ja tellimusi saab hallata otse telefonist.',
        leadPricingSentence,
        'Poeruumiga saate tutvuda siin:\nhttps://poeruum.ee',
        'Kui tekib küsimusi, vastan hea meelega.',
      ].join('\n\n'),
    })
  })
})
