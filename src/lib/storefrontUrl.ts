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

  const pathSlug = location.pathname.match(/^\/p\/([^/]+)(?:\/|$)/)?.[1]
  const requestedSlug = pathSlug || new URLSearchParams(location.search).get('store')
  if (!requestedSlug) return null

  try {
    const decodedSlug = decodeURIComponent(requestedSlug).toLowerCase()
    return validStoreSlug.test(decodedSlug) ? decodedSlug : null
  } catch {
    return null
  }
}

export function getRequestedProductSlug(location: Pick<Location, 'pathname'>) {
  const match = location.pathname.match(/(?:^|\/)toode\/([^/]+)\/?$/)
  if (!match?.[1]) return null

  try {
    const decodedSlug = decodeURIComponent(match[1]).toLowerCase()
    return validStoreSlug.test(decodedSlug) || /^[0-9a-f-]{16,}$/i.test(decodedSlug) ? decodedSlug : null
  } catch {
    return null
  }
}

export const getProductUrlSlug = (product: { id: string; slug?: string }) => product.slug || product.id

export function getStorefrontCanonicalUrl(storeSlug: string, product?: { id: string; slug?: string }) {
  const base = `https://${STOREFRONT_ROOT_DOMAIN}/p/${encodeURIComponent(storeSlug)}`
  return product ? `${base}/toode/${encodeURIComponent(getProductUrlSlug(product))}/` : `${base}/`
}

export function getStorefrontPath(storeSlug: string, product?: { id: string; slug?: string }) {
  const storePath = `/p/${encodeURIComponent(storeSlug)}`
  return product ? `${storePath}/toode/${encodeURIComponent(getProductUrlSlug(product))}/` : `${storePath}/`
}
