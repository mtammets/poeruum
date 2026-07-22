const configuredRootDomain = import.meta.env.VITE_STOREFRONT_ROOT_DOMAIN?.trim().toLowerCase()

export const STOREFRONT_ROOT_DOMAIN = (configuredRootDomain || 'poeruum.ee').replace(/^\.+|\.+$/g, '')

export const RESERVED_STORE_SLUGS = new Set([
  'admin', 'api', 'app', 'assets', 'auth', 'cdn', 'domains', 'mail', 'send', 'static', 'status', 'support', 'tugi', 'www',
])

const validStoreSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const isReservedStoreSlug = (slug: string) => RESERVED_STORE_SLUGS.has(slug.toLowerCase())

export function getStoreSlugFromHostname(hostname: string, rootDomain = STOREFRONT_ROOT_DOMAIN) {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '')
  const normalizedRoot = rootDomain.toLowerCase().replace(/^\.+|\.+$/g, '')
  const suffix = `.${normalizedRoot}`
  if (!normalizedHostname.endsWith(suffix)) return null

  const slug = normalizedHostname.slice(0, -suffix.length)
  if (!slug || slug.includes('.') || !validStoreSlug.test(slug) || isReservedStoreSlug(slug)) return null
  return slug
}

type StorefrontLocation = Pick<Location, 'hostname' | 'pathname' | 'search'>

export function getRequestedStoreSlug(location: StorefrontLocation) {
  const hostnameSlug = getStoreSlugFromHostname(location.hostname)
  if (hostnameSlug) return hostnameSlug

  const pathSlug = location.pathname.match(/^\/p\/([^/]+)\/?$/)?.[1]
  const requestedSlug = pathSlug || new URLSearchParams(location.search).get('store')
  if (!requestedSlug) return null

  try {
    const decodedSlug = decodeURIComponent(requestedSlug).toLowerCase()
    return validStoreSlug.test(decodedSlug) ? decodedSlug : null
  } catch {
    return null
  }
}
