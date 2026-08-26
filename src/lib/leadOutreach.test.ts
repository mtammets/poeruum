import { describe, expect, it } from 'vitest'
import {
  classifyContactEmail,
  contactMatchesWebsite,
  extractOpenAIResponseSources,
  finalizeGeneratedLeadDraft,
  normalizeEmail,
  normalizePublicUrl,
  sourceKey,
  sourceMatches,
  websiteDomain,
} from '../../supabase/functions/_shared/lead-utils'
import {
  hasCompleteLeadQualificationEvidence,
  storedLeadContactVerificationMatches,
  verifyLeadContactEvidence,
  verifyLeadWebEvidence,
} from '../../supabase/functions/_shared/lead-verification'

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

  it('extracts Puu Vägi open-page URLs and preserves citation titles while deduplicating sources', () => {
    const sources = extractOpenAIResponseSources({
      output: [
        {
          type: 'web_search_call',
          status: 'completed',
          action: {
            type: 'open_page',
            url: 'https://www.puuskulptuurid.ee/puukujude-tellimine/?utm_source=openai#kontakt',
          },
        },
        {
          type: 'web_search_call',
          status: 'completed',
          action: {
            type: 'search',
            sources: [{ url: 'https://puuvagi.ee/?fbclid=test', title: 'Puu Vägi OÜ' }],
          },
        },
        {
          type: 'web_search_call',
          status: 'completed',
          action: {
            type: 'find_in_page',
            url: 'https://www.puuskulptuurid.ee/kontakt/',
            title: 'Kontakt',
          },
        },
        {
          type: 'message',
          content: [{
            type: 'output_text',
            annotations: [{
              type: 'url_citation',
              url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
              title: 'Puukujude tellimine – Puu Vägi',
            }],
          }],
        },
      ],
    })

    expect([...sources.values()]).toHaveLength(3)
    expect(sources.get('puuskulptuurid.ee/puukujude-tellimine')).toEqual({
      url: 'https://www.puuskulptuurid.ee/puukujude-tellimine/',
      title: 'Puukujude tellimine – Puu Vägi',
    })
    expect(sources.get('puuvagi.ee/')).toEqual({
      url: 'https://puuvagi.ee/',
      title: 'Puu Vägi OÜ',
    })
    expect(sources.get('puuskulptuurid.ee/kontakt')).toEqual({
      url: 'https://www.puuskulptuurid.ee/kontakt/',
      title: 'Kontakt',
    })
  })

  it('accepts Puu Vägi evidence opened by a completed web-search call', () => {
    const result = verifyLeadWebEvidence({
      response: {
        status: 'completed',
        output: [{
          type: 'web_search_call',
          status: 'completed',
          action: {
            type: 'open_page',
            url: 'https://www.puuskulptuurid.ee/puukujude-tellimine/?utm_source=openai#tellimine',
          },
        }],
      },
      websiteUrl: 'https://www.puuskulptuurid.ee/',
      siteChecks: [
        {
          kind: 'commerce',
          url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
          finding: 'Tellimus esitatakse e-posti teel või vormi kaudu.',
        },
        {
          kind: 'product_type',
          url: 'https://puuskulptuurid.ee/puukujude-tellimine/?utm_medium=research',
          finding: 'Lehel pakutakse puukujusid ja puidust aiaobjekte.',
        },
        {
          kind: 'not_allowed',
          url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
          finding: 'Mudeli tundmatu kontrolliliik ei ole lubatud.',
        },
        {
          kind: 'market',
          url: 'https://puuskulptuurid.ee/meist/',
          finding: 'Sama domeeni teine, kuid avamata leht ei ole täpne allikas.',
        },
        {
          kind: 'contact',
          url: 'https://kataloog.example/puu-vagi',
          finding: 'Teise domeeni allikat ei usaldata.',
        },
        {
          kind: 'market',
          url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
          finding: '   ',
        },
      ],
      verificationUrl: 'https://puuskulptuurid.ee/puukujude-tellimine/#tooted',
      commerceCheckUrl: 'https://www.puuskulptuurid.ee/puukujude-tellimine/?utm_campaign=check',
    })

    expect(result.hasCompletedWebSearch).toBe(true)
    expect(result.siteChecks).toEqual([
      {
        kind: 'commerce',
        url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
        finding: 'Tellimus esitatakse e-posti teel või vormi kaudu.',
      },
      {
        kind: 'product_type',
        url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
        finding: 'Lehel pakutakse puukujusid ja puidust aiaobjekte.',
      },
    ])
    expect(result.verificationUrl).toBe('https://puuskulptuurid.ee/puukujude-tellimine/')
    expect(result.verificationIsUsable).toBe(true)
    expect(result.commerceCheckUrl).toBe('https://www.puuskulptuurid.ee/puukujude-tellimine/')
    expect(result.commerceCheckIsUsable).toBe(true)
  })

  it('rejects evidence without sources or a completed web-search call', () => {
    const input = {
      websiteUrl: 'https://puuskulptuurid.ee/',
      siteChecks: [{
        kind: 'commerce',
        url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
        finding: 'Tellimus esitatakse vormi kaudu.',
      }],
      verificationUrl: 'https://puuskulptuurid.ee/puukujude-tellimine/',
      commerceCheckUrl: 'https://puuskulptuurid.ee/puukujude-tellimine/',
    }
    const missingSources = verifyLeadWebEvidence({
      ...input,
      response: {
        output: [{
          type: 'web_search_call',
          status: 'completed',
          action: { type: 'search', sources: [] },
        }],
      },
    })
    const missingTool = verifyLeadWebEvidence({
      ...input,
      response: {
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            annotations: [{
              type: 'url_citation',
              url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
              title: 'Puukujude tellimine',
            }],
          }],
        }],
      },
    })

    for (const result of [missingSources, missingTool]) {
      expect(result.siteChecks).toEqual([])
      expect(result.verificationIsUsable).toBe(false)
      expect(result.commerceCheckIsUsable).toBe(false)
    }
    expect(missingSources.hasCompletedWebSearch).toBe(true)
    expect(missingTool.hasCompletedWebSearch).toBe(false)
  })

  it('does not trust an open-page URL from an incomplete tool call', () => {
    const result = verifyLeadWebEvidence({
      response: {
        output: [
          {
            type: 'web_search_call',
            status: 'completed',
            action: { type: 'search', sources: [{ url: 'https://puuskulptuurid.ee/' }] },
          },
          {
            type: 'web_search_call',
            status: 'incomplete',
            action: { type: 'open_page', url: 'https://puuskulptuurid.ee/puukujude-tellimine/' },
          },
        ],
      },
      websiteUrl: 'https://puuskulptuurid.ee/',
      siteChecks: [{
        kind: 'commerce',
        url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
        finding: 'Tellimus esitatakse vormi kaudu.',
      }],
      verificationUrl: 'https://puuskulptuurid.ee/puukujude-tellimine/',
      commerceCheckUrl: 'https://puuskulptuurid.ee/puukujude-tellimine/',
    })

    expect(result.hasCompletedWebSearch).toBe(true)
    expect(result.sources.has('puuskulptuurid.ee/')).toBe(true)
    expect(result.sources.has('puuskulptuurid.ee/puukujude-tellimine')).toBe(false)
    expect(result.siteChecks).toEqual([])
    expect(result.verificationIsUsable).toBe(false)
  })

  it('requires a verified check for every qualification class before a review can mutate lead state', () => {
    const partialChecks = [{
      kind: 'commerce' as const,
      url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
      finding: 'Tellimus esitatakse vormi kaudu.',
    }]
    const completeKinds = [
      'market',
      'business_size',
      'product_type',
      'sales_audience',
      'commerce',
      'purchase_complexity',
      'standard_products',
    ] as const
    const completeChecks = completeKinds.map((kind) => ({
      kind,
      url: 'https://puuskulptuurid.ee/',
      finding: `Kontrollitud ${kind}.`,
    }))

    expect(hasCompleteLeadQualificationEvidence(partialChecks)).toBe(false)
    expect(hasCompleteLeadQualificationEvidence(completeChecks)).toBe(true)
  })

  it('accepts an opened registry source only for market and business-size evidence', () => {
    const registryUrl = 'https://www.inforegister.ee/en/16421985-PUU-VAGI-OU/'
    const result = verifyLeadWebEvidence({
      response: {
        output: [
          {
            type: 'web_search_call',
            status: 'completed',
            action: { type: 'open_page', url: 'https://puuskulptuurid.ee/puukujude-muuk/' },
          },
          {
            type: 'web_search_call',
            status: 'completed',
            action: { type: 'open_page', url: registryUrl },
          },
        ],
      },
      websiteUrl: 'https://puuskulptuurid.ee/',
      siteChecks: [
        {
          kind: 'business_size',
          url: registryUrl,
          finding: 'Registriallikas kirjeldab ettevõtet mikroettevõttena.',
        },
        {
          kind: 'product_type',
          url: registryUrl,
          finding: 'Kolmanda osapoole allikas ei tohi tõendada toote liiki.',
        },
      ],
      verificationUrl: 'https://puuskulptuurid.ee/puukujude-muuk/',
    })

    expect(result.openedSourceKeys.has('inforegister.ee/en/16421985-puu-vagi-ou')).toBe(true)
    expect(result.siteChecks).toEqual([{
      kind: 'business_size',
      url: registryUrl,
      finding: 'Registriallikas kirjeldab ettevõtet mikroettevõttena.',
    }])
  })

  it('rejects a registry URL that only appeared in search results and was never opened', () => {
    const registryUrl = 'https://www.inforegister.ee/en/16421985-PUU-VAGI-OU/'
    const result = verifyLeadWebEvidence({
      response: {
        output: [{
          type: 'web_search_call',
          status: 'completed',
          action: { type: 'search', sources: [{ url: registryUrl }] },
        }],
      },
      websiteUrl: 'https://puuskulptuurid.ee/',
      siteChecks: [{
        kind: 'business_size',
        url: registryUrl,
        finding: 'Registriallikas kirjeldab ettevõtet mikroettevõttena.',
      }],
    })

    expect(result.siteChecks).toEqual([])
  })

  it('rejects registry evidence reached only through find-in-page', () => {
    const registryUrl = 'https://www.inforegister.ee/en/16421985-PUU-VAGI-OU/'
    const result = verifyLeadWebEvidence({
      response: {
        output: [{
          type: 'web_search_call',
          status: 'completed',
          action: { type: 'find_in_page', url: registryUrl, pattern: 'employees' },
        }],
      },
      websiteUrl: 'https://puuskulptuurid.ee/',
      siteChecks: [{
        kind: 'business_size',
        url: registryUrl,
        finding: 'Registriallikas kirjeldab ettevõtet mikroettevõttena.',
      }],
    })

    expect(result.siteChecks).toEqual([])
  })

  it('never treats a registry page as the company website for product evidence', () => {
    const registryUrl = 'https://www.inforegister.ee/en/16421985-PUU-VAGI-OU/'
    const result = verifyLeadWebEvidence({
      response: {
        output: [{
          type: 'web_search_call',
          status: 'completed',
          action: { type: 'open_page', url: registryUrl },
        }],
      },
      websiteUrl: registryUrl,
      siteChecks: [{
        kind: 'product_type',
        url: registryUrl,
        finding: 'Registrileht ei tohi tõendada ettevõtte tootevalikut.',
      }],
    })

    expect(result.siteChecks).toEqual([])
  })

  it('verifies a brand-domain mailbox only from the exact company contact page', () => {
    const verification = verifyLeadContactEvidence({
      contactEmail: 'info@puuvagi.ee',
      emailSourceUrl: 'https://puuskulptuurid.ee/puukujude-tellimine/',
      websiteUrl: 'https://puuskulptuurid.ee/',
      openedSourceKeys: new Set(['puuskulptuurid.ee/puukujude-tellimine']),
      siteChecks: [{
        kind: 'contact',
        url: 'https://www.puuskulptuurid.ee/puukujude-tellimine/',
        finding: 'Tellimiseks on avalik üldpostkast info@puuvagi.ee.',
      }],
    })

    expect(verification).toEqual({
      email: 'info@puuvagi.ee',
      source_url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
      website_domain: 'puuskulptuurid.ee',
    })
    expect(storedLeadContactVerificationMatches({
      qualification: { contact_verification: verification },
      contactEmail: 'INFO@PUUVAGI.EE',
      emailSourceUrl: 'https://www.puuskulptuurid.ee/puukujude-tellimine/?utm_source=test',
      websiteUrl: 'https://www.puuskulptuurid.ee/',
    })).toBe(true)
  })

  it('invalidates contact verification when the mailbox, source page or website changes', () => {
    const qualification = {
      contact_verification: {
        email: 'info@puuvagi.ee',
        source_url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
        website_domain: 'puuskulptuurid.ee',
      },
    }

    expect(verifyLeadContactEvidence({
      contactEmail: 'info@puuvagi.ee',
      emailSourceUrl: 'https://puuskulptuurid.ee/puukujude-tellimine/',
      websiteUrl: 'https://puuskulptuurid.ee/',
      openedSourceKeys: new Set(['puuskulptuurid.ee/puukujude-tellimine']),
      siteChecks: [{
        kind: 'contact',
        url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
        finding: 'Lehel on muu aadress info@teine.ee.',
      }],
    })).toBeNull()
    expect(storedLeadContactVerificationMatches({
      qualification,
      contactEmail: 'info@teine.ee',
      emailSourceUrl: 'https://puuskulptuurid.ee/puukujude-tellimine/',
      websiteUrl: 'https://puuskulptuurid.ee/',
    })).toBe(false)
    expect(storedLeadContactVerificationMatches({
      qualification,
      contactEmail: 'info@puuvagi.ee',
      emailSourceUrl: 'https://puuskulptuurid.ee/kontakt/',
      websiteUrl: 'https://puuskulptuurid.ee/',
    })).toBe(false)
    expect(storedLeadContactVerificationMatches({
      qualification,
      contactEmail: 'info@puuvagi.ee',
      emailSourceUrl: 'https://puuskulptuurid.ee/puukujude-tellimine/',
      websiteUrl: 'https://teine.ee/',
    })).toBe(false)
  })

  it('does not verify an alias-domain mailbox from a search result that was never opened', () => {
    expect(verifyLeadContactEvidence({
      contactEmail: 'info@puuvagi.ee',
      emailSourceUrl: 'https://puuskulptuurid.ee/puukujude-tellimine/',
      websiteUrl: 'https://puuskulptuurid.ee/',
      openedSourceKeys: new Set(),
      siteChecks: [{
        kind: 'contact',
        url: 'https://puuskulptuurid.ee/puukujude-tellimine/',
        finding: 'Otsingutulemus väidab, et lehel on info@puuvagi.ee.',
      }],
    })).toBeNull()
  })

  it('requires the mailbox and contact source to belong to the company website', () => {
    expect(contactMatchesWebsite('info@ettevote.ee', 'https://ettevote.ee', 'https://www.ettevote.ee/kontakt')).toBe(true)
    expect(contactMatchesWebsite('info@pood.ettevote.ee', 'https://ettevote.ee', 'https://pood.ettevote.ee/kontakt')).toBe(true)
    expect(contactMatchesWebsite('info@teine.ee', 'https://ettevote.ee', 'https://ettevote.ee/kontakt')).toBe(false)
    expect(contactMatchesWebsite('info@ettevote.ee', 'https://ettevote.ee', 'https://kataloog.ee/ettevote')).toBe(false)
  })

  it('preserves a model-selected natural closing instead of injecting fixed boilerplate', () => {
    const draft = finalizeGeneratedLeadDraft(
      'Tere!\r\n\r\nTeie käsitsi glasuuritud kruusid jäid silma.\r\n\r\nKas soovite näidispoe linki?',
    )
    expect(draft).toBe('Tere!\n\nTeie käsitsi glasuuritud kruusid jäid silma.\n\nKas soovite näidispoe linki?')
    expect(draft).not.toContain('Kas selline lahendus võiks')
  })

  it('normalizes excessive whitespace without rewriting the generated message', () => {
    const draft = finalizeGeneratedLeadDraft(
      '  Tere!  \n\n\n  Üks konkreetne tähelepanek.  \n\n  Kas teema on praegu ajakohane?  ',
    )
    expect(draft).toBe('Tere!\n\nÜks konkreetne tähelepanek.\n\nKas teema on praegu ajakohane?')
  })
})
