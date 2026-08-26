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

export const finalizeGeneratedLeadDraft = (value: unknown) => {
  return multilineValue(value, 5000)
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

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
