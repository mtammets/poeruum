import { getSharedAuthDomain } from './storefrontUrl'

const CHUNK_SIZE = 3000
const MAX_AGE = 60 * 60 * 24 * 365

type CookieDocument = Pick<Document, 'cookie'>
type LegacyStorage = Pick<Storage, 'getItem' | 'removeItem'>

/** One browser session across the platform and its shop subdomains. Tokens never
 * travel in redirects. Authorization remains with Supabase Auth and database RLS.
 */
export function createSharedAuthStorage(
  location: Pick<Location, 'hostname' | 'protocol'>,
  cookies: CookieDocument,
  legacyStorage: LegacyStorage,
) {
  const domain = getSharedAuthDomain(location.hostname)
  if (!domain) return undefined
  const attributes = `; Path=/; Domain=${domain}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
  const readCookies = () => new Map(cookies.cookie.split(';').map((part) => {
    const separator = part.indexOf('=')
    return [part.slice(0, separator).trim(), part.slice(separator + 1)]
  }))
  const write = (name: string, value: string, maxAge = MAX_AGE) => {
    cookies.cookie = `${name}=${value}; Max-Age=${maxAge}${attributes}`
  }
  const discardLegacy = (key: string) => {
    try { legacyStorage.removeItem(key) } catch { /* Storage may be disabled. */ }
  }
  const setItem = (key: string, value: string) => {
    const name = encodeURIComponent(key)
    const encoded = encodeURIComponent(value)
    const chunks = Math.ceil(encoded.length / CHUNK_SIZE)
    const previous = readCookies()
    for (let index = 0; index < chunks; index += 1) {
      write(`${name}.${index}`, encoded.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE))
    }
    // The manifest is also a migration marker. A zero count survives logout so
    // a stale localStorage session on another subdomain cannot sign the user in.
    write(name, String(chunks))
    for (const cookieName of previous.keys()) {
      if (cookieName.startsWith(`${name}.`) && Number(cookieName.slice(name.length + 1)) >= chunks) {
        write(cookieName, '', 0)
      }
    }
    if (readCookies().get(name) !== String(chunks)) {
      throw new Error('Sisselogimiseks luba Poeruumi küpsised.')
    }
    discardLegacy(key)
  }
  return {
    getItem(key: string) {
      const name = encodeURIComponent(key)
      const stored = readCookies()
      const manifest = stored.get(name)
      if (manifest === undefined) {
        let legacy: string | null = null
        try { legacy = legacyStorage.getItem(key) } catch { /* Storage may be disabled. */ }
        if (legacy) setItem(key, legacy)
        return legacy
      }
      discardLegacy(key)
      if (!/^\d+$/.test(manifest)) return null
      const count = Number(manifest)
      if (!count || count > 32) return null
      let encoded = ''
      for (let index = 0; index < count; index += 1) {
        const chunk = stored.get(`${name}.${index}`)
        if (chunk === undefined) return null
        encoded += chunk
      }
      try { return decodeURIComponent(encoded) } catch { return null }
    },
    setItem,
    removeItem(key: string) { setItem(key, '') },
  }
}
