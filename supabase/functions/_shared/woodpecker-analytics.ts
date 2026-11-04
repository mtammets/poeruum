export const WOODPECKER_CAMPAIGN = 'musta-rahni-2026'
export const WOODPECKER_START = '2026-11-04T04:00:00.000Z'
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const campaignSurfaces = ['directory', 'homepage', 'store'] as const
export type CampaignSurface = typeof campaignSurfaces[number]
export const campaignEvents = ['visit', 'engagement', 'scroll', 'shop_click', 'homepage_click', 'product_view', 'product_click', 'add_to_cart', 'checkout_start', 'checkout_redirect', 'checkout_error', 'bird_call', 'game_view', 'game_start', 'game_progress', 'game_end'] as const
export const campaignSources = ['Kaubamaja', 'Krük Krüki koduleht', 'Krük Krüki e-pood', 'Google', 'Instagram', 'Facebook', 'TikTok', 'Muud viitajad', 'Otse / teadmata'] as const
export type CampaignEvent = {
  id: string; visitor_id: string; session_id: string; surface: CampaignSurface
  event_name: typeof campaignEvents[number]; source: typeof campaignSources[number]
  device: 'mobile' | 'tablet' | 'desktop'; utm_campaign: string
  product_id: string; placement: string; game_id: string | null; value: number; duration: number
}
export type CampaignAction = Pick<CampaignEvent, 'event_name'> & Partial<Pick<CampaignEvent, 'product_id' | 'placement' | 'game_id' | 'value' | 'duration'>>
export function campaignSurfaceForHost(host: string): CampaignSurface | null {
  if (host === 'kaubamaja.poeruum.ee') return 'directory'
  if (host === 'kruk-kruk.ee' || host === 'www.kruk-kruk.ee') return 'homepage'
  if (host === 'kruk-kruk.poeruum.ee') return 'store'
  return null
}
export function validateCampaignEvents(input: unknown): CampaignEvent[] | null {
  if (!input || typeof input !== 'object' || !('events' in input) || !Array.isArray(input.events)
    || input.events.length < 1 || input.events.length > 20) return null
  const result: CampaignEvent[] = []
  for (const e of input.events) {
    if (!e || typeof e !== 'object' || ![e.id, e.visitor_id, e.session_id].every(v => typeof v === 'string' && uuidPattern.test(v))
      || !campaignSurfaces.includes(e.surface) || !campaignEvents.includes(e.event_name) || !campaignSources.includes(e.source)
      || !['mobile', 'tablet', 'desktop'].includes(e.device)
      || typeof e.utm_campaign !== 'string' || !/^[a-z0-9_.-]{0,80}$/.test(e.utm_campaign)
      || typeof e.product_id !== 'string' || e.product_id.length > 120
      || typeof e.placement !== 'string' || !/^[a-z_]{0,30}$/.test(e.placement)
      || !Number.isInteger(e.value) || e.value < 0 || e.value > 100000
      || !Number.isInteger(e.duration) || e.duration < 0 || e.duration > 86400
      || (e.event_name.startsWith('game_') ? typeof e.game_id !== 'string' || !uuidPattern.test(e.game_id) || e.surface !== 'directory' : e.game_id !== null)
      || (e.event_name === 'scroll' && ![25, 50, 75, 100].includes(e.value))) return null
    // Explicit projection: do not accept arbitrary metadata or personal data.
    result.push({ id: e.id, visitor_id: e.visitor_id, session_id: e.session_id, surface: e.surface,
      event_name: e.event_name, source: e.source, device: e.device, utm_campaign: e.utm_campaign,
      product_id: e.product_id, placement: e.placement, game_id: e.game_id, value: e.value, duration: e.duration })
  }
  return result
}
export function campaignCheckoutContext(input: unknown): { visitor_id: string; session_id: string } | null {
  if (!input || typeof input !== 'object' || !('visitor_id' in input) || !('session_id' in input)) return null
  return typeof input.visitor_id === 'string' && uuidPattern.test(input.visitor_id)
    && typeof input.session_id === 'string' && uuidPattern.test(input.session_id)
    ? { visitor_id: input.visitor_id, session_id: input.session_id } : null
}
