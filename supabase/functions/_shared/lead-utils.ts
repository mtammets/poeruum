const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const blockedHostnames = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])
const personalMailboxDomains = new Set([
  'gmail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mail.ee',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
])
const generalMailboxNames = new Set([
  'admin',
  'asiakaspalvelu',
  'contact',
  'customerservice',
  'eestikeelne',
  'hello',
  'info',
  'klienditugi',
  'kontakt',
  'marketing',
  'muuk',
  'myyk',
  'office',
  'orders',
  'pood',
  'sales',
  'shop',
  'support',
  'team',
  'teenindus',
  'tellimine',
  'tellimus',
  'tere',
  'turundus',
])
const permanentlyDeletableLeadStatuses = new Set(['new', 'ready', 'archived'])

export const textValue = (value: unknown, max: number) => String(value ?? '')
  .replace(/\p{Cc}/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)

export const multilineValue = (value: unknown, max: number) => String(value ?? '')
  .replace(/\r/g, '')
  .replace(/[^\S\n]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, max)

export const canPermanentlyDeleteLead = (status: unknown) => permanentlyDeletableLeadStatuses.has(String(status))

export const leadPricingSentence = 'Paindlikul paketil kuutasu ei ole – Poeruumi tasu tekib ainult siis, kui poe kaudu müük toimub.'

export const createLeadOutreachTemplate = () => ({
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

export const normalizeEmail = (value: unknown) => {
  const email = String(value ?? '').trim().toLowerCase()
  return emailPattern.test(email) && email.length <= 320 ? email : null
}

export const classifyContactEmail = (value: unknown): 'general_business' | 'personal_or_unclear' | 'missing' => {
  const email = normalizeEmail(value)
  if (!email) return 'missing'
  const domain = email.split('@')[1]
  if (personalMailboxDomains.has(domain)) return 'personal_or_unclear'
  const localPart = email.split('@')[0]
    .split('+')[0]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  if (generalMailboxNames.has(localPart)) return 'general_business'
  if ([...generalMailboxNames].some((name) => localPart.startsWith(`${name}.`) || localPart.startsWith(`${name}-`))) {
    return 'general_business'
  }
  return 'personal_or_unclear'
}

export const normalizePublicUrl = (value: unknown) => {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!hostname.includes('.') || blockedHostnames.has(hostname)) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || ['gclid', 'fbclid'].includes(key.toLowerCase())) {
        url.searchParams.delete(key)
      }
    }
    return url.toString()
  } catch {
    return null
  }
}

export const websiteDomain = (value: unknown) => {
  const normalized = normalizePublicUrl(value)
  if (!normalized) return null
  return new URL(normalized).hostname.toLowerCase().replace(/^www\./, '')
}

export const domainsRelated = (left: unknown, right: unknown) => {
  const a = String(left ?? '').trim().toLowerCase().replace(/^www\./, '')
  const b = String(right ?? '').trim().toLowerCase().replace(/^www\./, '')
  if (!a || !b) return false
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

export const contactMatchesWebsite = (emailValue: unknown, websiteValue: unknown, emailSourceValue: unknown) => {
  const email = normalizeEmail(emailValue)
  const website = websiteDomain(websiteValue)
  const emailSource = websiteDomain(emailSourceValue)
  if (!email || !website || !emailSource) return false
  const emailDomain = email.split('@')[1]
  return domainsRelated(website, emailSource) && domainsRelated(website, emailDomain)
}

export const sourceKey = (value: unknown) => {
  const normalized = normalizePublicUrl(value)
  if (!normalized) return null
  const url = new URL(normalized)
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  return `${hostname}${pathname}`.toLowerCase()
}

export const sourceMatches = (candidate: unknown, sourceUrls: Set<string>) => {
  const key = sourceKey(candidate)
  return Boolean(key && sourceUrls.has(key))
}

export type LeadResearchCandidateInput = {
  company_name?: unknown
  website_url?: unknown
  source_url?: unknown
  email_source_url?: unknown
  contact_email?: unknown
  location?: unknown
  segment?: unknown
  summary?: unknown
  fit_reason?: unknown
  evidence?: unknown
}

export type ValidatedLeadResearchCandidate = {
  company_name: string
  website_url: string
  website_domain: string
  source_url: string
  email_source_url: string
  contact_email: string
  contact_kind: 'general_business'
  location: string
  segment: string
  summary: string
  fit_reason: string
  evidence: string
}

export const validateLeadResearchCandidate = (
  candidate: LeadResearchCandidateInput,
  sourceUrls: Set<string>,
): ValidatedLeadResearchCandidate | null => {
  const companyName = textValue(candidate.company_name, 200)
  const websiteUrl = normalizePublicUrl(candidate.website_url)
  const website = websiteDomain(websiteUrl)
  const sourceUrl = normalizePublicUrl(candidate.source_url)
  if (!companyName || !websiteUrl || !website || !sourceUrl || !sourceMatches(sourceUrl, sourceUrls)) return null

  const rawEmailSourceUrl = normalizePublicUrl(candidate.email_source_url)
  const emailSourceUrl = rawEmailSourceUrl && sourceMatches(rawEmailSourceUrl, sourceUrls)
    ? rawEmailSourceUrl
    : null
  const contactEmail = emailSourceUrl ? normalizeEmail(candidate.contact_email) : null
  if (classifyContactEmail(contactEmail) !== 'general_business') return null
  if (!contactMatchesWebsite(contactEmail, websiteUrl, emailSourceUrl)) return null

  const summary = textValue(candidate.summary, 1000)
  const fitReason = textValue(candidate.fit_reason, 1200)
  const evidence = textValue(candidate.evidence, 1200)
  if (!summary || !fitReason || !evidence || !emailSourceUrl || !contactEmail) return null

  return {
    company_name: companyName,
    website_url: websiteUrl,
    website_domain: website,
    source_url: sourceUrl,
    email_source_url: emailSourceUrl,
    contact_email: contactEmail,
    contact_kind: 'general_business',
    location: textValue(candidate.location, 160),
    segment: textValue(candidate.segment, 160),
    summary,
    fit_reason: fitReason,
    evidence,
  }
}
