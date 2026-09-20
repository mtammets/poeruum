import type { DirectoryEvent } from '../../supabase/functions/_shared/directory-analytics'
import { createDirectorySession, isDirectoryAnalyticsLocation, type DirectoryAction } from './directoryAnalyticsSession'
import { getAnalyticsDevice, getAnalyticsReferrerHost, sanitizeAnalyticsCampaignValue } from './homepageAnalytics'
import { supabase } from './supabase'

const endpoint = `${String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')}/functions/v1/directory-analytics`
let track: ((action: DirectoryAction) => void) | null = null
export const trackDirectoryEvent = (action: DirectoryAction) => track?.(action)

export function startDirectoryAnalytics() {
  if (!supabase || !globalThis.crypto?.randomUUID
    || !isDirectoryAnalyticsLocation(window.location.hostname, window.location.pathname, endpoint)) return
  let stopped = false
  let allowed = false
  let queue: { event: DirectoryEvent; attempts: number }[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = 0
  const flush = async (leaving = false) => {
    clearTimeout(timer)
    if (!allowed || (inFlight > 0 && !leaving) || !queue.length) return
    inFlight++
    const batch = queue.splice(0, 20)
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ events: batch.map(({ event }) => event) }), credentials: 'omit', keepalive: true,
      })
      if (!response.ok && (response.status >= 500 || response.status === 429)) throw new Error('Retry')
    } catch {
      if (!stopped) queue.unshift(...batch.filter((item) => ++item.attempts < 3))
    } finally {
      inFlight--
      if (queue.length && !stopped && inFlight === 0) timer = setTimeout(() => { void flush() }, 2000)
    }
  }
  const session = createDirectorySession({
    now: Date.now, uuid: () => crypto.randomUUID(),
    context: () => ({
      referrer_host: getAnalyticsReferrerHost(document.referrer, window.location.hostname),
      utm_source: sanitizeAnalyticsCampaignValue(new URLSearchParams(window.location.search).get('utm_source'), 80),
      device_type: getAnalyticsDevice(window.innerWidth),
    }),
    emit: (event) => {
      if (queue.length >= 200) return
      queue.push({ event, attempts: 0 })
      clearTimeout(timer)
      timer = setTimeout(() => { void flush() }, 600)
    },
  })
  // Buffer early impressions until shared authentication has resolved.
  const pending: DirectoryAction[] = [{ event_name: 'page_view' }]
  const accept = (action: DirectoryAction) => {
    if (stopped) return
    if (allowed) session(action)
    else if (pending.length < 100) pending.push(action)
  }
  track = accept
  void supabase.auth.getSession().then(({ data, error }) => {
    if (stopped || error || data.session?.user.app_metadata?.role === 'admin') return
    allowed = true
    pending.splice(0).forEach(session)
  }).catch(() => undefined)
  const auth = supabase.auth.onAuthStateChange((_event, next) => {
    if (next?.user.app_metadata?.role === 'admin') {
      allowed = false
      queue = []
      pending.length = 0
      if (track === accept) track = null
    }
  })
  const hide = () => { if (document.visibilityState === 'hidden') void flush(true) }
  const leave = () => { void flush(true) }
  document.addEventListener('visibilitychange', hide)
  window.addEventListener('pagehide', leave)
  return () => {
    void flush()
    stopped = true
    clearTimeout(timer)
    if (track === accept) track = null
    auth.data.subscription.unsubscribe()
    document.removeEventListener('visibilitychange', hide)
    window.removeEventListener('pagehide', leave)
  }
}
