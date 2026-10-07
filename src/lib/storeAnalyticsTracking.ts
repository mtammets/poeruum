import { useEffect, useRef, useState } from 'react'
import type { StoreAnalyticsEvent } from '../../supabase/functions/_shared/store-analytics'
import { createStoreAnalyticsSession, isStoreAnalyticsLocation, storeTrafficSource } from './storeAnalyticsSession'
import { supabase } from './supabase'

const endpoint = `${String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')}/functions/v1/store-analytics`

function startStoreAnalytics(storeId: string, context: { source: StoreAnalyticsEvent['source']; location: Pick<Location, 'hostname' | 'pathname' | 'search'> }) {
  if (!supabase || !globalThis.crypto?.randomUUID || !isStoreAnalyticsLocation(context.location, endpoint)) return
  let stopped = false
  let allowed = false
  let excluded = false
  let queue: { event: StoreAnalyticsEvent; attempts: number }[] = []
  const pending: (string | undefined)[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = 0
  const flush = async (leaving = false) => {
    clearTimeout(timer)
    if (!allowed || !queue.length || (inFlight > 0 && !leaving)) return
    inFlight++
    const batch = queue.splice(0, 20)
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'omit', keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ store_id: storeId, events: batch.map(({ event }) => event) }) })
      if (response.status >= 500 || response.status === 429) throw new Error('Retry')
    } catch {
      if (!stopped && allowed) queue.unshift(...batch.filter((item) => ++item.attempts < 3))
    } finally {
      inFlight--
      if (queue.length && !stopped && inFlight === 0) timer = setTimeout(() => { void flush() }, 2000)
    }
  }
  const session = createStoreAnalyticsSession({ now: Date.now, uuid: () => crypto.randomUUID(),
    source: context.source,
    emit: (event) => {
      if (queue.length >= 200) return
      queue.push({ event, attempts: 0 })
      clearTimeout(timer)
      timer = setTimeout(() => { void flush() }, 500)
    },
  })
  const track = (productId?: string) => {
    if (stopped) return
    if (allowed) session(productId)
    else if (pending.length < 100) pending.push(productId)
  }
  // Auth must resolve first. Signed-in merchants and admin previews are excluded.
  void supabase.auth.getSession().then(({ data, error }) => {
    if (stopped || excluded || error || data.session) return
    allowed = true
    pending.splice(0).forEach(session)
  }).catch(() => undefined)
  const auth = supabase.auth.onAuthStateChange((_event, next) => {
    if (next) { excluded = true; allowed = false; queue = []; pending.length = 0 }
  })
  const hide = () => { if (document.visibilityState === 'hidden') void flush(true) }
  const leave = () => { void flush(true) }
  document.addEventListener('visibilitychange', hide)
  window.addEventListener('pagehide', leave)
  return { track, stop: () => {
    void flush(true)
    stopped = true
    clearTimeout(timer)
    auth.data.subscription.unsubscribe()
    document.removeEventListener('visibilitychange', hide)
    window.removeEventListener('pagehide', leave)
  } }
}

export function useStoreAnalyticsTracking(storeId: string | undefined, enabled: boolean, productId: string | undefined) {
  // Capture before the storefront's effects remove the Kaubamaja return marker.
  const [context] = useState(() => {
    const { hostname, pathname, search } = window.location
    const params = new URLSearchParams(search)
    return { location: { hostname, pathname, search }, source: storeTrafficSource(document.referrer, hostname, params.get('utm_source') ?? params.get('from')) }
  })
  const tracker = useRef<ReturnType<typeof startStoreAnalytics>>(undefined)
  useEffect(() => {
    if (!storeId || !enabled) return
    const current = startStoreAnalytics(storeId, context)
    tracker.current = current
    return () => { current?.stop(); tracker.current = undefined }
  }, [storeId, enabled, context])
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observe = () => {
      clearTimeout(timer)
      // Ignore slides passed while swiping and background tabs.
      if (document.visibilityState === 'visible') timer = setTimeout(() => tracker.current?.track(productId), 900)
    }
    observe()
    document.addEventListener('visibilitychange', observe)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', observe) }
  }, [storeId, enabled, productId])
}
