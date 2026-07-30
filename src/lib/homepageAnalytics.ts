import { createRandomId } from './randomId'

export type HomepageAnalyticsEvent =
  | 'page_view'
  | 'section_view'
  | 'signup_start'
  | 'demo_open'
  | 'faq_open'
  | 'account_created'

export type AnalyticsAudience = 'anonymous' | 'merchant'
export type AnalyticsDevice = 'mobile' | 'tablet' | 'desktop'

type AnalyticsLocation = Pick<Location, 'hostname' | 'pathname' | 'search'>

const endpoint = `${String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')}/functions/v1/homepage-analytics`
let analyticsSessionId = ''

export const isHomepageAnalyticsLocation = (location: AnalyticsLocation) => {
  const hostname = location.hostname.toLowerCase().replace(/\.$/, '')
  if (!['poeruum.ee', 'www.poeruum.ee'].includes(hostname) || location.pathname !== '/') return false
  const params = new URLSearchParams(location.search)
  return !params.has('billing') && !params.has('checkout') && !params.has('stripe_connect')
}

export const getAnalyticsDevice = (viewportWidth: number): AnalyticsDevice => {
  if (viewportWidth < 768) return 'mobile'
  if (viewportWidth < 1100) return 'tablet'
  return 'desktop'
}

export const sanitizeAnalyticsCampaignValue = (value: unknown, max = 100) => String(value ?? '')
  .trim()
  .toLocaleLowerCase('et')
  .replace(/[^a-z0-9äöõüšž._ -]/gi, '')
  .replace(/\s+/g, ' ')
  .slice(0, max)

export const getAnalyticsReferrerHost = (referrer: string, currentHostname: string) => {
  try {
    const hostname = new URL(referrer).hostname.toLowerCase().replace(/\.$/, '')
    return hostname === currentHostname.toLowerCase().replace(/\.$/, '') ? '' : hostname.slice(0, 120)
  } catch {
    return ''
  }
}

const getAnalyticsSessionId = () => {
  if (!analyticsSessionId) {
    analyticsSessionId = createRandomId().replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64).padEnd(16, '0')
  }
  return analyticsSessionId
}

export const trackHomepageEvent = (
  eventName: HomepageAnalyticsEvent,
  eventLabel = '',
  audience: AnalyticsAudience = 'anonymous',
) => {
  if (!endpoint.startsWith('https://') || !isHomepageAnalyticsLocation(window.location)) return
  const params = new URLSearchParams(window.location.search)
  const payload = {
    session_id: getAnalyticsSessionId(),
    event_name: eventName,
    event_label: eventLabel,
    audience,
    referrer_host: getAnalyticsReferrerHost(document.referrer, window.location.hostname),
    utm_source: sanitizeAnalyticsCampaignValue(params.get('utm_source'), 80),
    utm_medium: sanitizeAnalyticsCampaignValue(params.get('utm_medium'), 80),
    utm_campaign: sanitizeAnalyticsCampaignValue(params.get('utm_campaign'), 100),
    device_type: getAnalyticsDevice(window.innerWidth),
  }

  void fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(payload),
    credentials: 'omit',
    keepalive: true,
  }).catch(() => undefined)
}
