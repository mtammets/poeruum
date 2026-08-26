import { describe, expect, it } from 'vitest'
import {
  classifyContactEmail,
  contactMatchesWebsite,
  finalizeGeneratedLeadDraft,
  leadClosingQuestion,
  leadPricingSentence,
  normalizeEmail,
  normalizePublicUrl,
  sourceKey,
  sourceMatches,
  websiteDomain,
} from '../../supabase/functions/_shared/lead-utils'

describe('lead outreach public data safeguards', () => {
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

  it('adds the truthful pricing sentence and selected closing to every generated draft', () => {
    const draft = finalizeGeneratedLeadDraft(
      'Tere!\n\nNägin, et võtate tellimusi Instagramis.\n\nKas soovid rohkem infot?',
    )
    expect(draft).toContain(`\n\n${leadPricingSentence}\n\n`)
    expect(draft).toMatch(new RegExp(`${leadClosingQuestion.replace('?', '\\?')}$`))
    expect(draft).not.toContain('Kas soovid rohkem infot?')
  })

  it('does not duplicate mandatory generated-draft paragraphs', () => {
    const draft = finalizeGeneratedLeadDraft(
      `Tere!\n\n${leadPricingSentence}\n\n${leadClosingQuestion}`,
    )
    expect(draft.match(/Paindlikul paketil kuutasu ei ole/g)).toHaveLength(1)
    expect(draft.match(/Kas selline lahendus võiks/g)).toHaveLength(1)
  })
})
