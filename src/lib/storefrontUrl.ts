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

export function isStoreDirectoryHostname(hostname: string, rootDomain = STOREFRONT_ROOT_DOMAIN) {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '')
  const normalizedRoot = rootDomain.toLowerCase().replace(/^\.+|\.+$/g, '')
  return normalizedHostname === `kaubamaja.${normalizedRoot}`
    || normalizedHostname === 'kaubamaja.localhost'
}

export function isPlatformHostname(hostname: string, rootDomain = STOREFRONT_ROOT_DOMAIN) {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  const normalizedRoot = rootDomain.toLowerCase().replace(/^\.+|\.+$/g, '')

  if (normalizedHostname === 'localhost' || normalizedHostname.endsWith('.localhost')) return true
  if (normalizedHostname === '::1' || normalizedHostname === '0:0:0:0:0:0:0:1') return true
  if (/^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(normalizedHostname)) return true

  const ipv4 = normalizedHostname.split('.').map(Number)
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [first, second] = ipv4
    return first === 10
      || first === 127
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 0 && ipv4.every((part) => part === 0))
  }

  if (normalizedHostname === normalizedRoot || normalizedHostname === `www.${normalizedRoot}`) return true
  if (!normalizedHostname.endsWith(`.${normalizedRoot}`)) return false

  const subdomain = normalizedHostname.slice(0, -(normalizedRoot.length + 1))
  return !subdomain.includes('.') && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subdomain)
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
