type StripeRequirementsLinkLocation = Pick<Location, 'pathname' | 'search'>

export type StripeRequirementsLinkIntent = 'none' | 'valid' | 'invalid' | 'conflict'

export const getStripeRequirementsLinkIntent = (location: StripeRequirementsLinkLocation): StripeRequirementsLinkIntent => {
  const params = new URLSearchParams(location.search)
  const values = params.getAll('stripe_requirements')
  if (!values.length) return 'none'
  if (params.has('billing') || params.has('stripe_connect')) return 'conflict'
  if (location.pathname !== '/' || values.length !== 1 || values[0] !== '1') return 'invalid'
  return 'valid'
}

export const isStripeRequirementsLink = (location: StripeRequirementsLinkLocation) => {
  return getStripeRequirementsLinkIntent(location) === 'valid'
}

export const removeStripeRequirementsLinkParam = (href: string) => {
  const url = new URL(href)
  url.searchParams.delete('stripe_requirements')
  return `${url.pathname}${url.search}${url.hash}`
}

export const getStripeRequirementsStoreTarget = (store: {
  isPublished: boolean
  hasStripeAccount: boolean
}) => ({
  screen: store.isPublished ? 'storefront' as const : 'payments' as const,
  initialSettingsSection: store.isPublished ? 'payments' as const : null,
  openEmbeddedRemediation: store.hasStripeAccount,
})
