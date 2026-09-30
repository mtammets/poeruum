export type StripeReturnContext = {
  returnTo: string; storeId: string; mode: 'onboarding' | 'management' | 'remediation'; createdAt: number
}
const storageKey = 'poeruum-stripe-return'

export function stripeRedirectUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !['connect.stripe.com', 'dashboard.stripe.com'].includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Stripe’i seadistust ei saanud avada. Proovi uuesti.')
  }
  return url.href
}

export function readStripeReturnContext(): StripeReturnContext | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
    if (!value || typeof value.storeId !== 'string' || !['onboarding', 'management', 'remediation'].includes(value.mode)
      || typeof value.createdAt !== 'number' || Date.now() - value.createdAt > 86400000) return null
    const destination = new URL(value.returnTo, window.location.origin)
    if (destination.origin !== window.location.origin || destination.pathname.startsWith('/stripe/connect/')) return null
    return { ...value, returnTo: `${destination.pathname}${destination.search}${destination.hash}` }
  } catch { return null }
}

export function clearStripeReturnContext() { sessionStorage.removeItem(storageKey) }

export function beginStripeRedirect(url: string, storeId: string, mode: StripeReturnContext['mode']) {
  const destination = stripeRedirectUrl(url)
  let target: Window = window
  // The local preview embeds the actual app. Stripe must use the whole tab;
  // resume the same fixture and its desktop/phone view after returning.
  if (import.meta.env.DEV && window.parent !== window) {
    try {
      if (window.parent.location.origin === window.location.origin
        && ['/previews/sellers.html', '/previews/payments.html'].includes(window.parent.location.pathname)) target = window.parent
    } catch { /* A different origin is not an authorized preview wrapper. */ }
  }
  const returnTo = `${target.location.pathname}${target.location.search}${target.location.hash}`
  sessionStorage.setItem(storageKey, JSON.stringify({ returnTo, storeId, mode, createdAt: Date.now() }))
  target.location.assign(destination)
}
