// Company pages are opt-in. Krük-Krük is the first shop with an authored page.
export const hasCompanyHomepage = (slug) => slug === 'kruk-kruk'
export const COMPANY_HOMEPAGE_PATH = '/koduleht/'
export const COMPANY_HOMEPAGE_IMAGE = '/images/campaigns/musta-rahni-paevad.webp'
export const isCompanyHomepagePath = (pathname) => /^\/(?:p\/[^/]+\/)?koduleht\/?$/.test(pathname)

export function companyHomepageMetadata(name, copy = {}) {
  return {
    title: `${name} — lugu ja looming`,
    description: typeof copy.heroIntro === 'string' ? copy.heroIntro : 'Olen Madis Kuusalust. Hooldan metsi, pügan hekke ja joonistan. Siit leiad Krük-Krüki loo ja kahe rähni märgiga nokkmütsi.',
  }
}
