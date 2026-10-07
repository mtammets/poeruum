import { storeTrafficSource, type StoreAnalyticsEvent } from '../../supabase/functions/_shared/store-analytics'
export { storeTrafficSource }

const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit' })
export function createStoreAnalyticsSession(options: {
  now: () => number; uuid: () => string; source: StoreAnalyticsEvent['source']; emit: (event: StoreAnalyticsEvent) => void
}) {
  let session: { id: string; day: string; activeAt: number; products: Set<string> } | null = null
  return (productId?: string) => {
    const now = options.now()
    const day = dayFormat.format(now)
    if (!session || session.day !== day || now - session.activeAt >= 30 * 60 * 1000 || now < session.activeAt) {
      session = { id: options.uuid(), day, activeAt: now, products: new Set() }
      options.emit({ id: options.uuid(), session_id: session.id, event_name: 'visit', product_id: '', source: options.source })
    }
    session.activeAt = now
    if (productId && !session.products.has(productId)) {
      session.products.add(productId)
      options.emit({ id: options.uuid(), session_id: session.id, event_name: 'product_view', product_id: productId, source: options.source })
    }
  }
}

export function isStoreAnalyticsLocation(location: Pick<Location, 'hostname' | 'pathname' | 'search'>, endpoint: string) {
  try {
    const destination = new URL(endpoint)
    const local = /(?:^|\.)localhost$/.test(location.hostname) || location.hostname === '127.0.0.1'
    if (local && !['localhost', '127.0.0.1'].includes(destination.hostname)) return false
    if (!local && destination.protocol !== 'https:') return false
    const params = new URLSearchParams(location.search)
    return !/\/(?:haldus|admin|preview|e2e)(?:\/|$)/.test(location.pathname)
      && !['owner_login', 'preview', 'checkout', 'billing'].some((key) => params.has(key))
  } catch { return false }
}
