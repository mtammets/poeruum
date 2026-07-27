export const RESERVED_STORE_SLUGS: Set<string>
export function decodePathname(pathname: string): string | null
export function isReservedStoreSlug(slug: string): boolean
export function getStoreSlugFromHostname(hostname: string, rootDomain?: string): string | null
export function getStoreSlugFromPath(pathname: string): string | null
export function getProductSlugFromPath(pathname: string): string | null
