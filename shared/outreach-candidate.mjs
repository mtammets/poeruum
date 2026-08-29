import { URL } from 'node:url'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.ee',
  'icloud.com',
  'live.com',
  'mail.ee',
  'me.com',
  'online.ee',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
])

const GENERAL_MAILBOXES = new Set([
  'admin',
  'contact',
  'hello',
  'info',
  'klienditeenindus',
  'klienditugi',
  'kontakt',
  'kontor',
  'ladu',
  'marketing',
  'muuk',
  'myyk',
  'office',
  'order',
  'orders',
  'pood',
  'sales',
  'shop',
  'store',
  'support',
  'team',
  'teenindus',
  'tellimine',
  'tellimus',
  'tere',
  'turundus',
])

const COMPANY_NAME_STOP_WORDS = new Set([
  'aktsiaselts',
  'as',
  'company',
  'eesti',
  'est',
  'estonia',
  'grupp',
  'group',
  'osauhing',
  'ou',
  'partnerid',
  'partners',
  'tulundusuhistu',
])

export const normalizeOutreachToken = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '')

export const normalizeOutreachEmail = (value) => {
  const email = String(value ?? '').trim().toLowerCase()
  return EMAIL_PATTERN.test(email) && email.length <= 320 ? email : null
}

export const normalizeOutreachWebsite = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null
    url.hash = ''
    return url.toString().slice(0, 1000)
  } catch {
    return null
  }
}

const companyBrandTokens = (name) => String(name ?? '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter((token) => token.length >= 4 && !COMPANY_NAME_STOP_WORDS.has(token))

const websiteBrandTokens = (websites) => websites.flatMap((website) => {
  const normalized = normalizeOutreachWebsite(website)
  if (!normalized) return []
  const hostname = new URL(normalized).hostname.replace(/^www\./i, '')
  const token = normalizeOutreachToken(hostname.split('.')[0])
  return token.length >= 4 ? [token] : []
})

const emailDomainBrandToken = (email) => {
  const hostname = email.split('@')[1]
  if (FREE_EMAIL_DOMAINS.has(hostname)) return null
  const token = normalizeOutreachToken(hostname.split('.')[0])
  return token.length >= 4 ? token : null
}

const brandMatches = (localPart, brand) => localPart === brand
  || (brand.length >= 5 && localPart.includes(brand))
  || (localPart.length >= 5 && brand.includes(localPart))

export const classifyOutreachEmail = (value, companyName, websites = []) => {
  const email = normalizeOutreachEmail(value)
  if (!email) return { eligible: false, score: 0, reason: 'invalid' }

  const [rawLocalPart, domain] = email.split('@')
  const localPartWithoutTag = rawLocalPart.split('+')[0]
  const localPart = normalizeOutreachToken(localPartWithoutTag)
  const separatedParts = localPartWithoutTag
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[._-]+/)
    .filter(Boolean)
  const isFreeMailbox = FREE_EMAIL_DOMAINS.has(domain)

  const generalPart = separatedParts.find((part) => GENERAL_MAILBOXES.has(normalizeOutreachToken(part)))
  if (generalPart || GENERAL_MAILBOXES.has(localPart)) {
    return { eligible: true, score: isFreeMailbox ? 90 : 110, reason: 'general' }
  }

  const looksLikeSeparatedPersonalName = separatedParts.length >= 2
    && separatedParts.every((part) => /^[a-z]{1,30}$/.test(part))
  if (looksLikeSeparatedPersonalName) {
    return { eligible: false, score: 0, reason: 'personal_name' }
  }

  const websiteBrands = websiteBrandTokens(websites)
  const domainBrand = emailDomainBrandToken(email)
  const companyBrands = companyBrandTokens(companyName)

  if (domainBrand && brandMatches(localPart, domainBrand)) {
    return { eligible: true, score: 100, reason: 'mail_domain_brand' }
  }
  if (websiteBrands.some((brand) => brandMatches(localPart, brand))) {
    return { eligible: true, score: isFreeMailbox ? 80 : 95, reason: 'website_brand' }
  }
  if (companyBrands.length === 1 && brandMatches(localPart, companyBrands[0])) {
    return { eligible: true, score: isFreeMailbox ? 70 : 85, reason: 'company_brand' }
  }

  return { eligible: false, score: 0, reason: 'personal_or_unclear' }
}

export const selectOutreachEmail = (emails, companyName, websites = []) => {
  const eligible = [...new Set(emails.map(normalizeOutreachEmail).filter(Boolean))]
    .map((email) => ({ email, ...classifyOutreachEmail(email, companyName, websites) }))
    .filter((candidate) => candidate.eligible)
    .sort((left, right) => right.score - left.score || left.email.localeCompare(right.email))
  return eligible[0] ?? null
}

export const isOutreachActivityCode = (value) => {
  const code = String(value ?? '').trim()
  if (!/^\d{2,5}$/.test(code)) return false
  const division = Number.parseInt(code.slice(0, 2), 10)
  return (division >= 10 && division <= 32) || division === 47
}
