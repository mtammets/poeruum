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

export const hasCompleteLeadQualificationEvidence = (siteChecks: LeadSiteCheck[]) => (
  qualificationCheckKinds.every((kind) => siteChecks.some((check) => check.kind === kind))
)

export const verifyLeadContactEvidence = ({
  contactEmail,
  emailSourceUrl,
  websiteUrl,
  siteChecks,
  openedSourceKeys,
}: {
  contactEmail: unknown
  emailSourceUrl: unknown
  websiteUrl: unknown
  siteChecks: LeadSiteCheck[]
  openedSourceKeys: Set<string>
}) => {
  const email = normalizeEmail(contactEmail)
  const sourceUrl = normalizePublicUrl(emailSourceUrl)
  const website = websiteDomain(websiteUrl)
  if (
    !email
    || !sourceUrl
    || !website
    || !domainsRelated(website, websiteDomain(sourceUrl))
    || !sourceMatches(sourceUrl, openedSourceKeys)
  ) return null
  const matchingCheck = siteChecks.find((check) => (
    check.kind === 'contact'
    && sourceKey(check.url) === sourceKey(sourceUrl)
    && (check.finding.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/giu) ?? [])
      .some((value) => normalizeEmail(value) === email)
  ))
  return matchingCheck ? { email, source_url: sourceUrl, website_domain: website } : null
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
}: {
  response: unknown
  websiteUrl: unknown
  siteChecks: unknown
  verificationUrl?: unknown
  commerceCheckUrl?: unknown
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
      const isCompanySource = !isRegistrySource && domainsRelated(website, sourceDomain)
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
