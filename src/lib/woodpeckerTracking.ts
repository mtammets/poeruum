import { useEffect, useState } from 'react'
import { campaignSurfaceForHost, WOODPECKER_START, type CampaignAction, type CampaignEvent, type CampaignSurface } from '../../supabase/functions/_shared/woodpecker-analytics'
import { storeTrafficSource } from './storeAnalyticsSession'
import { supabase } from './supabase'

const endpoint = `${String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')}/functions/v1/woodpecker-analytics`
// A fresh anonymous identity for each page load; no analytics cookies or storage.
let pageVisitor: string | undefined
const tallinnDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit' })
let active: { track: (action: CampaignAction) => void; context: () => { visitor_id: string; session_id: string } | undefined } | undefined
export const trackWoodpecker = (action: CampaignAction) => active?.track(action)
export const woodpeckerCheckoutContext = () => active?.context()

export function canTrackWoodpecker(location: Pick<Location, 'hostname' | 'pathname' | 'search'>, surface: CampaignSurface, destination: string) {
  try {
    const endpoint = new URL(destination)
    const localEndpoint = ['localhost', '127.0.0.1'].includes(endpoint.hostname)
    const localHost = location.hostname === 'kruk-kruk.localhost' ? 'kruk-kruk.ee'
      : location.hostname.endsWith('.poeruum.localhost') ? location.hostname.replace(/\.localhost$/, '.ee') : null
    const host = localEndpoint && localHost ? localHost : location.hostname
    return (endpoint.protocol === 'https:' || (localEndpoint && Boolean(localHost))) && campaignSurfaceForHost(host) === surface
      && !/\/(?:admin|haldus|eelvaade|preview|e2e)(?:\/|$)/.test(location.pathname)
      && !['theme', 'preview', 'owner_login'].some(key => new URLSearchParams(location.search).has(key))
      && (surface !== 'directory' || location.pathname === '/')
  } catch { return false }
}
type EntryContext = { location: Pick<Location, 'hostname' | 'pathname' | 'search'>; referrer: string }
export function startWoodpeckerTracking(surface: CampaignSurface, entry: EntryContext = { location: window.location, referrer: document.referrer }) {
  if (!supabase || !globalThis.crypto?.randomUUID || !canTrackWoodpecker(entry.location, surface, endpoint)) return
  let stopped = false, allowed = false, excluded = false
  let inFlight = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let identity: { visitor_id: string; session_id: string; last: number; duration: number } | undefined
  let queue: { event: CampaignEvent; attempts: number }[] = []
  const pending: CampaignAction[] = []
  const params = new URLSearchParams(entry.location.search)
  const source = (() => {
    try {
      const referrerHost = new URL(entry.referrer).hostname
      const surface = referrerHost === entry.location.hostname ? null : campaignSurfaceForHost(referrerHost)
      if (surface === 'homepage') return 'Krük Krüki koduleht'
      if (surface === 'store') return 'Krük Krüki e-pood'
    } catch { /* no referrer */ }
    return storeTrafficSource(entry.referrer, entry.location.hostname, params.get('utm_source') ?? params.get('from'))
  })()
  const context = {
    surface, source, device: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1100 ? 'tablet' : 'desktop',
    utm_campaign: (params.get('utm_campaign') ?? '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 80),
  } as const
  const flush = async (leaving = false) => {
    clearTimeout(timer)
    if (!allowed || (inFlight > 0 && !leaving) || !queue.length) return
    inFlight++
    const batch = queue.splice(0, 20)
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'omit', keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ events: batch.map(item => item.event) }) })
      if (response.status >= 500 || response.status === 429) throw new Error('Retry')
    } catch {
      if (!stopped && allowed) queue.unshift(...batch.filter(item => ++item.attempts < 3))
    } finally {
      inFlight--
      if (queue.length && !stopped && inFlight === 0) timer = setTimeout(() => void flush(), 1500)
    }
  }
  const emit = (action: CampaignAction) => {
    if (!identity || queue.length >= 200) return
    queue.push({ event: { ...context, id: crypto.randomUUID(), visitor_id: identity.visitor_id, session_id: identity.session_id,
      product_id: '', placement: '', game_id: null, value: 0, duration: 0, ...action }, attempts: 0 })
    clearTimeout(timer); timer = setTimeout(() => void flush(), 500)
  }
  const track = (action: CampaignAction) => {
    if (stopped || excluded || Date.now() < Date.parse(WOODPECKER_START)) return
    if (!allowed) { if (pending.length < 100) pending.push(action); return }
    const now = Date.now()
    if (!identity || now - identity.last >= 1800000 || now < identity.last || tallinnDay.format(now) !== tallinnDay.format(identity.last)) {
      identity = { visitor_id: pageVisitor ??= crypto.randomUUID(), session_id: crypto.randomUUID(), last: now, duration: 0 }
      emit({ event_name: 'visit' })
    }
    identity.last = now
    emit(action)
    if (action.event_name === 'game_end' || action.event_name === 'checkout_redirect') void flush(true)
  }
  const current = { track, context: () => allowed && !excluded && Date.now() >= Date.parse(WOODPECKER_START) && identity
    ? { visitor_id: identity.visitor_id, session_id: identity.session_id } : undefined }
  active = current
  void supabase.auth.getSession().then(({ data, error }) => {
    if (stopped || excluded || error || data.session) return
    allowed = true
    track({ event_name: 'visit' })
    pending.splice(0).forEach(track)
  }).catch(() => undefined)
  const auth = supabase.auth.onAuthStateChange((_event, session) => {
    if (session) { excluded = true; allowed = false; queue = []; pending.length = 0; identity = undefined }
  })
  let visibleAt = performance.now()
  let wasVisible = !document.hidden
  const engagement = () => {
    const now = performance.now()
    if (wasVisible && allowed) {
      track({ event_name: 'visit' }) // idempotent visit; also renews expired sessions
      if (identity) {
        identity.duration = Math.min(86400, identity.duration + Math.max(0, Math.min(Math.round((now - visibleAt) / 1000), Math.floor((Date.now() - Date.parse(WOODPECKER_START)) / 1000))))
        track({ event_name: 'engagement', duration: identity.duration })
      }
    }
    visibleAt = now; wasVisible = !document.hidden
  }
  const heartbeat = setInterval(engagement, 15000)
  const seen = new Set<number>()
  const scroll = () => {
    const height = document.documentElement.scrollHeight
    const percentage = height ? (window.scrollY + window.innerHeight) / height * 100 : 0
    for (const value of [25, 50, 75, 100]) if (percentage >= value && !seen.has(value)) {
      seen.add(value); track({ event_name: 'scroll', value })
    }
  }
  const click = (event: MouseEvent) => {
    if (event.type === 'auxclick' && event.button !== 1) return
    const link = event.target instanceof Element ? event.target.closest('a') : null
    if (!link) return
    let target: URL
    try { target = new URL(link.href) } catch { return }
    if (event.defaultPrevented) return
    const destination = campaignSurfaceForHost(target.hostname)
    if (destination === 'store' && surface !== 'store') track({ event_name: target.pathname.includes('/toode/') ? 'product_click' : 'shop_click', placement: surface })
    if (destination === 'homepage' && surface !== 'homepage') track({ event_name: 'homepage_click', placement: surface })
  }
  const hide = () => { engagement(); if (document.hidden) void flush(true) }
  const leave = () => { engagement(); void flush(true) }
  document.addEventListener('visibilitychange', hide)
  window.addEventListener('pagehide', leave)
  window.addEventListener('scroll', scroll, { passive: true })
  document.addEventListener('click', click)
  document.addEventListener('auxclick', click)
  return () => {
    leave(); stopped = true; clearTimeout(timer); clearInterval(heartbeat)
    if (active === current) active = undefined
    auth.data.subscription.unsubscribe()
    document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave)
    window.removeEventListener('scroll', scroll); document.removeEventListener('click', click); document.removeEventListener('auxclick', click)
  }
}
export function useWoodpeckerTracking(surface: CampaignSurface, enabled = true) {
  // Read during render, before the storefront removes its incoming ?from marker.
  const [entry] = useState<EntryContext>(() => ({ location: { hostname: window.location.hostname, pathname: window.location.pathname, search: window.location.search }, referrer: document.referrer }))
  useEffect(() => { if (enabled) return startWoodpeckerTracking(surface, entry) }, [surface, enabled, entry])
}
