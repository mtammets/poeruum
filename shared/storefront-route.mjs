export const RESERVED_STORE_SLUGS = new Set([
  'admin', 'api', 'app', 'assets', 'auth', 'cdn', 'domains', 'kaubamaja', 'mail', 'send',
  'static', 'status', 'support', 'tugi', 'www',
])

const validStoreSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const validProductIdentifier = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*|[0-9a-f-]{16,})$/i

const decodeIdentifier = (value, pattern) => {
  if (!value) return null
  try {
    const decoded = decodeURIComponent(value).toLowerCase()
    return pattern.test(decoded) ? decoded : null
  } catch {
    return null
  }
}

export function decodePathname(pathname) {
  try {
    return decodeURIComponent(String(pathname))
  } catch {
    return null
  }
}

export const isReservedStoreSlug = (slug) => RESERVED_STORE_SLUGS.has(String(slug).toLowerCase())

export function getStoreSlugFromHostname(hostname, rootDomain = 'poeruum.ee') {
  const normalizedHostname = String(hostname).toLowerCase().replace(/\.$/, '')
  const normalizedRoot = String(rootDomain).toLowerCase().replace(/^\.+|\.+$/g, '')
  const suffix = `.${normalizedRoot}`
  if (!normalizedHostname.endsWith(suffix)) return null

  const slug = normalizedHostname.slice(0, -suffix.length)
  if (!slug || slug.includes('.') || !validStoreSlug.test(slug) || isReservedStoreSlug(slug)) return null
  return slug
}

export function getStoreSlugFromPath(pathname) {
  const encoded = String(pathname).match(/^\/p\/([^/]+)(?:\/|$)/)?.[1]
  return decodeIdentifier(encoded, validStoreSlug)
}

export function getProductSlugFromPath(pathname) {
  const encoded = String(pathname).match(/(?:^|\/)toode\/([^/]+)\/?$/)?.[1]
  return decodeIdentifier(encoded, validProductIdentifier)
}
