export const COMPANY_HOMEPAGE_PATH: string
export const COMPANY_HOMEPAGE_IMAGE: string
export const COMPANY_HOMEPAGE_HOST: string
export const COMPANY_HOMEPAGE_URL: string
export function getCompanyHomepageStoreSlug(hostname: string): string | null
export function isCompanyHomepageLocation(location: { hostname: string; pathname: string }): boolean
export function hasCompanyHomepage(slug: string | undefined): boolean
export function isCompanyHomepagePath(pathname: string): boolean
export function companyHomepageMetadata(name: string, copy?: { heroIntro?: string }): { title: string; description: string }
