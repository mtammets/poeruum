import type { LeadSiteCheck } from './lead-copy.ts'
import {
  domainsRelated,
  extractOpenAIResponseSources,
  normalizeEmail,
  normalizePublicUrl,
  sourceKey,
  sourceMatches,
  textValue,
  websiteDomain,
} from './lead-utils.ts'

const siteCheckKinds = new Set<LeadSiteCheck['kind']>([
  'market',
  'business_size',
  'product_type',
  'sales_audience',
  'commerce',
  'purchase_complexity',
  'standard_products',
  'contact',
])

const qualificationCheckKinds: LeadSiteCheck['kind'][] = [
  'market',
  'business_size',
  'product_type',
  'sales_audience',
  'commerce',
  'purchase_complexity',
  'standard_products',
]

const registryEvidenceKinds = new Set<LeadSiteCheck['kind']>(['market', 'business_size'])
const trustedRegistryDomains = [
  'ariregister.rik.ee',
  'inforegister.ee',
  'e-krediidiinfo.ee',
  'teatmik.ee',
  'ssb.ee',
]

const observationStopWords = new Set([
  'ettevote', 'ettevotte', 'tooted', 'tooteid', 'valmistab', 'pakub', 'nende', 'teie',
  'ning', 'selle', 'mille', 'jaoks', 'kohta', 'lehel', 'valik', 'silma', 'meeldis',
])

const evidenceTokens = (value: unknown) => new Set(
  textValue(value, 500)
    .toLocaleLowerCase('et-EE')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length >= 5 && !observationStopWords.has(token)) ?? [],
)

const tokensShareStem = (left: string, right: string) => left === right
  || (left.length >= 6 && right.length >= 6 && left.slice(0, 6) === right.slice(0, 6))

export const verifiedObservationMatchesSiteChecks = ({
  verifiedObservation,
  verificationUrl,
  siteChecks,
}: {
  verifiedObservation: unknown
  verificationUrl: unknown
  siteChecks: LeadSiteCheck[]
}) => {
  const verificationKey = sourceKey(verificationUrl)
  const observationTokens = evidenceTokens(verifiedObservation)
  if (!verificationKey || !observationTokens.size) return false
  const findingTokens = evidenceTokens(siteChecks
    .filter((check) => (
      (check.kind === 'product_type' || check.kind === 'standard_products')
      && sourceKey(check.url) === verificationKey
    ))
    .map((check) => check.finding)
    .join(' '))
  const supportedTokens = [...observationTokens].filter((observationToken) => (
    [...findingTokens].some((findingToken) => tokensShareStem(observationToken, findingToken))
  ))
  return findingTokens.size > 0 && supportedTokens.length >= Math.min(2, observationTokens.size)
}

export const hasCompleteLeadQualificationEvidence = (siteChecks: LeadSiteCheck[]) => (
  qualificationCheckKinds.every((kind) => siteChecks.some((check) => check.kind === kind))
)

export const verifyLeadContactEvidence = ({
  contactEmail,
  emailSourceUrl,
  websiteUrl,
  companyName,
  siteChecks,
  openedSourceKeys,
  sourceKeys = openedSourceKeys,
  requireOpenedSource = true,
}: {
  contactEmail: unknown
  emailSourceUrl: unknown
  websiteUrl: unknown
  companyName?: unknown
  siteChecks: LeadSiteCheck[]
  openedSourceKeys: Set<string>
  sourceKeys?: Set<string>
  requireOpenedSource?: boolean
}) => {
  const email = normalizeEmail(contactEmail)
  const sourceUrl = normalizePublicUrl(emailSourceUrl)
  const website = websiteDomain(websiteUrl)
  const emailDomain = email?.split('@')[1] ?? null
  const companyIdentity = textValue(companyName, 200)
    .toLocaleLowerCase('et-EE')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '')
  const emailDomainLabel = String(emailDomain ?? '').split('.')[0]
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
  const emailDomainMatchesWebsite = Boolean(emailDomain && domainsRelated(website, emailDomain))
  const emailDomainMatchesCompanyName = Boolean(
    emailDomainLabel.length >= 5 && companyIdentity.includes(emailDomainLabel),
  )
  if (
    !email
    || !sourceUrl
    || !website
    || !emailDomain
    || (!emailDomainMatchesWebsite && !emailDomainMatchesCompanyName)
    || !domainsRelated(website, websiteDomain(sourceUrl))
    || !sourceMatches(sourceUrl, requireOpenedSource ? openedSourceKeys : sourceKeys)
  ) return null
  const matchingCheck = siteChecks.find((check) => (
    check.kind === 'contact'
    && sourceKey(check.url) === sourceKey(sourceUrl)
    && (check.finding.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/giu) ?? [])
      .some((value) => normalizeEmail(value) === email)
  ))
  return matchingCheck
    ? {
      email,
      source_url: sourceUrl,
      website_domain: website,
      source_was_opened: sourceMatches(sourceUrl, openedSourceKeys),
      ...(!emailDomainMatchesWebsite && emailDomainMatchesCompanyName
        ? { email_domain_alias_verified: true }
        : {}),
    }
    : null
}

export const storedLeadContactVerificationMatches = ({
  qualification,
  contactEmail,
  emailSourceUrl,
  websiteUrl,
}: {
  qualification: unknown
  contactEmail: unknown
  emailSourceUrl: unknown
  websiteUrl: unknown
}) => {
  if (!qualification || typeof qualification !== 'object') return false
  const verification = (qualification as Record<string, unknown>).contact_verification
  if (!verification || typeof verification !== 'object') return false
  const record = verification as Record<string, unknown>
  if (record.source_was_opened !== true) return false
  const storedEmail = normalizeEmail(record.email)
  const currentEmail = normalizeEmail(contactEmail)
  const storedSource = sourceKey(record.source_url)
  const currentSource = sourceKey(emailSourceUrl)
  const storedWebsite = websiteDomain(record.website_domain)
    || websiteDomain(`https://${String(record.website_domain ?? '')}`)
  const currentWebsite = websiteDomain(websiteUrl)
  if (!storedEmail || !currentEmail || !storedSource || !currentSource || !storedWebsite || !currentWebsite) return false
  return storedEmail === currentEmail
    && storedSource === currentSource
    && domainsRelated(storedWebsite, currentWebsite)
    && (
      domainsRelated(currentWebsite, currentEmail.split('@')[1])
      || record.email_domain_alias_verified === true
    )
}

const hasCompletedWebSearchCall = (response: unknown) => {
  if (!response || typeof response !== 'object') return false
  const output = (response as Record<string, unknown>).output
  if (!Array.isArray(output)) return false
  return output.some((item) => {
    if (!item || typeof item !== 'object') return false
    const record = item as Record<string, unknown>
    return record.type === 'web_search_call' && record.status === 'completed'
  })
}

const completedOpenedSourceKeys = (response: unknown) => {
  const keys = new Set<string>()
  if (!response || typeof response !== 'object') return keys
  const output = (response as Record<string, unknown>).output
  if (!Array.isArray(output)) return keys
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (record.type !== 'web_search_call' || record.status !== 'completed') continue
    const action = record.action && typeof record.action === 'object'
      ? record.action as Record<string, unknown>
      : null
    if (!action || action.type !== 'open_page') continue
    const key = sourceKey(action.url)
    if (key) keys.add(key)
  }
  return keys
}

export const verifyLeadWebEvidence = ({
  response,
  websiteUrl: websiteValue,
  siteChecks: rawSiteChecks,
  verificationUrl: verificationValue,
  commerceCheckUrl: commerceCheckValue,
  requireOpenedCompanyPages = true,
}: {
  response: unknown
  websiteUrl: unknown
  siteChecks: unknown
  verificationUrl?: unknown
  commerceCheckUrl?: unknown
  requireOpenedCompanyPages?: boolean
}) => {
  const hasCompletedWebSearch = hasCompletedWebSearchCall(response)
  const sources = extractOpenAIResponseSources(response)
  const sourceKeys = new Set(sources.keys())
  const openedSourceKeys = completedOpenedSourceKeys(response)
  const website = websiteDomain(websiteValue)

  const siteChecks = hasCompletedWebSearch && website && Array.isArray(rawSiteChecks)
    ? rawSiteChecks.slice(0, 12).flatMap((item): LeadSiteCheck[] => {
      if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
      const kind = textValue(record.kind, 40) as LeadSiteCheck['kind']
      const url = normalizePublicUrl(record.url)
      const finding = textValue(record.finding, 400)
      const sourceDomain = websiteDomain(url)
      const isRegistrySource = trustedRegistryDomains.some((domain) => domainsRelated(domain, sourceDomain))
      const isCompanySource = !isRegistrySource
        && domainsRelated(website, sourceDomain)
        && sourceMatches(url, requireOpenedCompanyPages ? openedSourceKeys : sourceKeys)
      const isTrustedRegistrySource = isRegistrySource
        && registryEvidenceKinds.has(kind)
        && sourceMatches(url, openedSourceKeys)
      if (
        !siteCheckKinds.has(kind)
        || !url
        || !finding
        || !sourceMatches(url, sourceKeys)
        || (!isCompanySource && !isTrustedRegistrySource)
      ) return []
      return [{ kind, url, finding }]
    })
    : []

  const verificationUrl = normalizePublicUrl(verificationValue)
  const verificationIsUsable = Boolean(
    hasCompletedWebSearch
    && website
    && verificationUrl
    && sourceMatches(verificationUrl, sourceKeys)
    && (!requireOpenedCompanyPages || sourceMatches(verificationUrl, openedSourceKeys))
    && domainsRelated(website, websiteDomain(verificationUrl)),
  )

  const commerceCheckUrl = normalizePublicUrl(commerceCheckValue)
  const commerceCheckIsUsable = Boolean(
    hasCompletedWebSearch
    && commerceCheckUrl
    && sourceMatches(commerceCheckUrl, sourceKeys)
    && siteChecks.some((check) => (
      check.kind === 'commerce' && sourceKey(check.url) === sourceKey(commerceCheckUrl)
    )),
  )

  return {
    hasCompletedWebSearch,
    sources,
    sourceKeys,
    openedSourceKeys,
    siteChecks,
    verificationUrl,
    verificationIsUsable,
    commerceCheckUrl,
    commerceCheckIsUsable,
  }
}
