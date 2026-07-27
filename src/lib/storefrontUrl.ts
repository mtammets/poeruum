import {
  RESERVED_STORE_SLUGS,
  getProductSlugFromPath,
  getStoreSlugFromHostname as parseStoreSlugFromHostname,
  getStoreSlugFromPath,
  isReservedStoreSlug,
} from '../../shared/storefront-route.mjs'

const configuredRootDomain = import.meta.env.VITE_STOREFRONT_ROOT_DOMAIN?.trim().toLowerCase()

export const STOREFRONT_ROOT_DOMAIN = (configuredRootDomain || 'poeruum.ee').replace(/^\.+|\.+$/g, '')

export { RESERVED_STORE_SLUGS, isReservedStoreSlug }

export function getStoreSlugFromHostname(hostname: string, rootDomain = STOREFRONT_ROOT_DOMAIN) {
  return parseStoreSlugFromHostname(hostname, rootDomain)
}

type StorefrontLocation = Pick<Location, 'hostname' | 'pathname' | 'search'>

export function getRequestedStoreSlug(location: StorefrontLocation) {
  const hostnameSlug = getStoreSlugFromHostname(location.hostname)
  if (hostnameSlug) return hostnameSlug

  const pathSlug = getStoreSlugFromPath(location.pathname)
  if (pathSlug) return pathSlug
  const requestedSlug = new URLSearchParams(location.search).get('store')
  if (!requestedSlug) return null

  try {
    const decodedSlug = decodeURIComponent(requestedSlug).toLowerCase()
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(decodedSlug) ? decodedSlug : null
  } catch {
    return null
  }
}

export function getRequestedProductSlug(location: Pick<Location, 'pathname'>) {
  return getProductSlugFromPath(location.pathname)
}

export const getProductUrlSlug = (product: { id: string; slug?: string }) => product.slug || product.id

export function isDedicatedStorefrontHostname(hostname: string, rootDomain = STOREFRONT_ROOT_DOMAIN) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return getStoreSlugFromHostname(normalized, rootDomain) !== null
    || (normalized !== rootDomain
      && normalized !== `www.${rootDomain}`
      && !['localhost', '127.0.0.1'].includes(normalized))
}

export function getStorefrontCanonicalUrl(
  storeSlug: string,
  product?: { id: string; slug?: string },
  hostname = `${storeSlug}.${STOREFRONT_ROOT_DOMAIN}`,
) {
  const normalizedHostname = hostname.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '')
  const base = `https://${normalizedHostname}`
  return product ? `${base}/toode/${encodeURIComponent(getProductUrlSlug(product))}/` : `${base}/`
}

export function getStorefrontPath(storeSlug: string, product?: { id: string; slug?: string }) {
  const storePath = `/p/${encodeURIComponent(storeSlug)}`
  return product ? `${storePath}/toode/${encodeURIComponent(getProductUrlSlug(product))}/` : `${storePath}/`
}
