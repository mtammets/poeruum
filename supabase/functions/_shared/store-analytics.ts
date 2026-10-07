const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const STORE_SOURCES = ['Kaubamaja', 'Google', 'Instagram', 'Facebook', 'TikTok', 'Muud viitajad', 'Otse / teadmata'] as const
export type StoreSource = typeof STORE_SOURCES[number]
export type StoreAnalyticsEvent = {
  id: string
  session_id: string
  event_name: 'visit' | 'product_view'
  product_id: string
  source: StoreSource
}

// Store only a fixed source category, never a URL, search term or campaign text.
export function storeTrafficSource(referrer: string, hostname: string, source: string | null): StoreSource {
  const campaign = source?.trim().toLowerCase()
  const campaigns: Record<string, StoreSource> = { kaubamaja: 'Kaubamaja', google: 'Google', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' }
  if (campaign && Object.hasOwn(campaigns, campaign)) return campaigns[campaign]
  try {
    const host = new URL(referrer).hostname.toLowerCase()
    if (host === hostname.toLowerCase()) return 'Otse / teadmata'
    if (host === 'kaubamaja.poeruum.ee') return 'Kaubamaja'
    if (/^(?:www\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host)) return 'Google'
    for (const [domain, label] of [['instagram.com', 'Instagram'], ['facebook.com', 'Facebook'], ['tiktok.com', 'TikTok']] as const) {
      if (host === domain || host.endsWith(`.${domain}`)) return label
    }
    return 'Muud viitajad'
  } catch { return 'Otse / teadmata' }
}

export function validateStoreAnalytics(input: unknown): { store_id: string; events: StoreAnalyticsEvent[] } | null {
  if (!input || typeof input !== 'object' || !('store_id' in input) || !('events' in input)
    || typeof input.store_id !== 'string' || !uuid.test(input.store_id)
    || !Array.isArray(input.events) || input.events.length < 1 || input.events.length > 20) return null
  const events: StoreAnalyticsEvent[] = []
  for (const item of input.events) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !uuid.test(item.id)
      || typeof item.session_id !== 'string' || !uuid.test(item.session_id)
      || !['visit', 'product_view'].includes(item.event_name) || !STORE_SOURCES.includes(item.source)
      || typeof item.product_id !== 'string'
      || (item.event_name === 'visit' ? item.product_id !== '' : item.product_id.length < 1 || item.product_id.length > 120)) return null
    events.push({ id: item.id, session_id: item.session_id, event_name: item.event_name, product_id: item.product_id, source: item.source })
  }
  return { store_id: input.store_id, events }
}
