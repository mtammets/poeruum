import type { DirectoryEvent } from '../../supabase/functions/_shared/directory-analytics'

type Context = Pick<DirectoryEvent, 'referrer_host' | 'utm_source' | 'device_type'>
export type DirectoryAction = Pick<DirectoryEvent, 'event_name' | 'store_id' | 'product_id' | 'placement' | 'position' | 'result_count'>
type Session = Context & { id: string; activeAt: number; day: string; seen: string[] }
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit' })

export function createDirectorySession(options: {
  context: () => Context
  now: () => number
  uuid: () => string
  emit: (event: DirectoryEvent) => void
}) {
  let session: Session | null = null
  const emit = (action: DirectoryAction) => {
    if (!session) return
    const semanticKey = `${action.event_name}:${action.store_id || ''}:${action.product_id || ''}:${action.placement || ''}`
    if (action.event_name !== 'search') {
      if (session.seen.includes(semanticKey)) return
      session.seen.push(semanticKey)
    }
    options.emit({ ...action, id: options.uuid(), session_id: session.id,
      referrer_host: session.referrer_host, utm_source: session.utm_source, device_type: session.device_type })
  }
  return (action: DirectoryAction) => {
    const now = options.now()
    const day = dayFormat.format(now)
    if (!session || now - session.activeAt >= 30 * 60 * 1000 || session.day !== day || now < session.activeAt) {
      session = { ...options.context(), id: options.uuid(), activeAt: now, day, seen: [] }
    }
    session.activeAt = now
    emit({ event_name: 'page_view' })
    // A deliberate card click also proves that this card was seen (including keyboard use).
    if (action.event_name === 'store_click') emit({ ...action, event_name: 'store_impression' })
    emit(action)
  }
}

export function isDirectoryAnalyticsLocation(hostname: string, pathname: string, endpoint: string) {
  try {
    const destination = new URL(endpoint)
    if (pathname !== '/') return false
    if (hostname === 'kaubamaja.poeruum.ee') return destination.protocol === 'https:'
    return hostname === 'kaubamaja.poeruum.localhost' && ['localhost', '127.0.0.1'].includes(destination.hostname)
  } catch { return false }
}
