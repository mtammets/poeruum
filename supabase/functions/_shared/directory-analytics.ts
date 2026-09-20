const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type DirectoryEvent = {
  id: string
  session_id: string
  event_name: 'page_view' | 'store_impression' | 'store_click' | 'product_click' | 'search'
  store_id?: string
  product_id?: string
  placement?: 'directory' | 'search'
  position?: number
  result_count?: number
  referrer_host: string
  utm_source: string
  device_type: 'mobile' | 'tablet' | 'desktop'
}

export function validateDirectoryEvents(input: unknown): DirectoryEvent[] | null {
  if (!input || typeof input !== 'object' || !('events' in input)) return null
  const events = input.events
  if (!Array.isArray(events) || events.length < 1 || events.length > 20) return null
  const result: DirectoryEvent[] = []
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return null
    if (typeof event.id !== 'string' || !uuid.test(event.id)
      || typeof event.session_id !== 'string' || !uuid.test(event.session_id)
      || !['page_view', 'store_impression', 'store_click', 'product_click', 'search'].includes(event.event_name)
      || !['mobile', 'tablet', 'desktop'].includes(event.device_type)) return null
    const item: DirectoryEvent = {
      id: event.id, session_id: event.session_id, event_name: event.event_name,
      device_type: event.device_type,
      referrer_host: typeof event.referrer_host === 'string' && /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/i.test(event.referrer_host)
        ? event.referrer_host.toLowerCase().slice(0, 120) : '',
      utm_source: typeof event.utm_source === 'string' ? event.utm_source.trim().toLowerCase()
        .replace(/[^a-z0-9äöõüšž._ -]/g, '').replace(/\s+/g, ' ').slice(0, 80) : '',
    }
    if (['store_impression', 'store_click', 'product_click'].includes(item.event_name)) {
      if (typeof event.store_id !== 'string' || !uuid.test(event.store_id)
        || !['directory', 'search'].includes(event.placement)
        || !Number.isInteger(event.position) || event.position < 1 || event.position > 10000
        || event.result_count !== undefined) return null
      item.store_id = event.store_id
      item.placement = event.placement
      item.position = event.position
      if (item.event_name === 'product_click') {
        if (typeof event.product_id !== 'string' || event.product_id.length < 1 || event.product_id.length > 120) return null
        item.product_id = event.product_id
      } else if (event.product_id !== undefined) return null
    } else {
      if (['store_id', 'product_id', 'position', 'placement'].some((key) => event[key] !== undefined)) return null
      if (item.event_name === 'search') {
        if (!Number.isInteger(event.result_count) || event.result_count < 0 || event.result_count > 100000) return null
        item.result_count = event.result_count
      } else if (event.result_count !== undefined) return null
    }
    // Ignore all other input, including names, search text and client timestamps.
    result.push(item)
  }
  return result
}
