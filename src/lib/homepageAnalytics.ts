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
const engagementHeartbeatMilliseconds = 15_000
const maximumEngagementMilliseconds = 30 * 60 * 1_000
let analyticsSessionId = ''
let analyticsEngagementMilliseconds = 0
let analyticsEngagementStartedAt: number | null = null
let analyticsLastSentEngagementSeconds = 0
let stopCurrentEngagementTracking: (() => void) | null = null

export const isHomepageAnalyticsLocation = (location: AnalyticsLocation) => {
  const hostname = location.hostname.toLowerCase().replace(/\.$/, '')
  if (!['poeruum.ee', 'www.poeruum.ee'].includes(hostname) || location.pathname !== '/') return false
  const params = new URLSearchParams(location.search)
  return !params.has('billing') && !params.has('checkout') && !params.has('stripe_connect')
    && !params.has('stripe_requirements')
}

export const getAnalyticsDevice = (viewportWidth: number): AnalyticsDevice => {
  if (viewportWidth < 768) return 'mobile'
  if (viewportWidth < 1100) return 'tablet'
  return 'desktop'
}

export const getAnalyticsEngagementSeconds = (milliseconds: number) => Math.min(
  maximumEngagementMilliseconds / 1_000,
  Math.max(0, Math.floor(milliseconds / 1_000)),
)

export const isAnalyticsEngagementActive = (visibilityState: DocumentVisibilityState, hasFocus: boolean) => (
  visibilityState === 'visible' && hasFocus
)

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

const getAnalyticsContext = (audience: AnalyticsAudience) => {
  if (!endpoint.startsWith('https://') || !isHomepageAnalyticsLocation(window.location)) return
  const params = new URLSearchParams(window.location.search)
  return {
    session_id: getAnalyticsSessionId(),
    audience,
    referrer_host: getAnalyticsReferrerHost(document.referrer, window.location.hostname),
    utm_source: sanitizeAnalyticsCampaignValue(params.get('utm_source'), 80),
    utm_medium: sanitizeAnalyticsCampaignValue(params.get('utm_medium'), 80),
    utm_campaign: sanitizeAnalyticsCampaignValue(params.get('utm_campaign'), 100),
    device_type: getAnalyticsDevice(window.innerWidth),
  }
}

const postAnalyticsPayload = (payload: Record<string, unknown>) => {
  void fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(payload),
    credentials: 'omit',
    keepalive: true,
  }).catch(() => undefined)
}

export const trackHomepageEvent = (
  eventName: HomepageAnalyticsEvent,
  eventLabel = '',
  audience: AnalyticsAudience = 'anonymous',
) => {
  const context = getAnalyticsContext(audience)
  if (!context) return
  postAnalyticsPayload({ ...context, event_name: eventName, event_label: eventLabel })
}

const trackHomepageEngagement = (engagedSeconds: number, audience: AnalyticsAudience) => {
  if (engagedSeconds <= analyticsLastSentEngagementSeconds) return
  const context = getAnalyticsContext(audience)
  if (!context) return
  analyticsLastSentEngagementSeconds = engagedSeconds
  postAnalyticsPayload({
    ...context,
    event_name: 'engagement',
    event_label: '',
    engaged_seconds: engagedSeconds,
  })
}

export const startHomepageEngagementTracking = (audience: AnalyticsAudience = 'anonymous') => {
  stopCurrentEngagementTracking?.()

  const updateEngagement = () => {
    const now = performance.now()
    if (analyticsEngagementStartedAt !== null) {
      analyticsEngagementMilliseconds = Math.min(
        maximumEngagementMilliseconds,
        analyticsEngagementMilliseconds + Math.max(0, now - analyticsEngagementStartedAt),
      )
    }
    analyticsEngagementStartedAt = (
      analyticsEngagementMilliseconds < maximumEngagementMilliseconds
      && isAnalyticsEngagementActive(document.visibilityState, document.hasFocus())
    ) ? now : null
  }

  const sendEngagement = () => {
    updateEngagement()
    trackHomepageEngagement(getAnalyticsEngagementSeconds(analyticsEngagementMilliseconds), audience)
  }

  const handleActivityChange = () => sendEngagement()
  const handlePageHide = () => {
    sendEngagement()
    analyticsEngagementStartedAt = null
  }
  updateEngagement()
  const heartbeat = window.setInterval(sendEngagement, engagementHeartbeatMilliseconds)
  window.addEventListener('focus', handleActivityChange)
  window.addEventListener('blur', handleActivityChange)
  window.addEventListener('pagehide', handlePageHide)
  window.addEventListener('pageshow', handleActivityChange)
  document.addEventListener('visibilitychange', handleActivityChange)

  let isStopped = false
  const stop = () => {
    if (isStopped) return
    isStopped = true
    sendEngagement()
    analyticsEngagementStartedAt = null
    window.clearInterval(heartbeat)
    window.removeEventListener('focus', handleActivityChange)
    window.removeEventListener('blur', handleActivityChange)
    window.removeEventListener('pagehide', handlePageHide)
    window.removeEventListener('pageshow', handleActivityChange)
    document.removeEventListener('visibilitychange', handleActivityChange)
    if (stopCurrentEngagementTracking === stop) stopCurrentEngagementTracking = null
  }
  stopCurrentEngagementTracking = stop
  return stop
}
