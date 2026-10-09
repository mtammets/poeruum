import { useCallback, useEffect, useRef, useState } from 'react'
import type { RevenueDashboard, RevenueEvent } from './lib/adminDashboard'
import { requireSupabase } from './lib/supabase'

const emptyRevenue: RevenueDashboard = {
  month_total_cents: 0, today_total_cents: 0, subscription_total_cents: 0,
  transaction_fee_total_cents: 0, refund_total_cents: 0, recent_events: [],
}
const month = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', timeZone: 'Europe/Tallinn',
}).format(date)

export type RevenueNotice = { id: number; eventIds: string[]; from: number; to: number; delta: number }

export default function useAdminRevenue(userId: string | null, feedbackActive: boolean) {
  const [revenue, setRevenue] = useState(emptyRevenue)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  const [live, setLive] = useState(false)
  const [notice, setNotice] = useState<RevenueNotice | null>(null)
  const feedback = useRef(feedbackActive)
  const refreshRef = useRef<() => void>(() => {})
  const sequence = useRef(0)
  const refresh = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    feedback.current = feedbackActive
    if (!feedbackActive) setNotice(null)
  }, [feedbackActive])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    setRevenue(emptyRevenue)
    setError('')
    setLoading(true)
    setStale(false)
    setLive(false)
    setNotice(null)
    if (!userId) return

    const client = requireSupabase()
    let cancelled = false
    let inFlight = false
    let queued = false
    let debounce: number | undefined
    let previous: { data: RevenueDashboard; month: string } | null = null
    const pending = new Map<string, number>()
    const seen = new Set<string>()
    const visible = () => feedback.current && document.visibilityState === 'visible'

    // Serialize all refresh sources. A signal during a request always gets a follow-up.
    const load = async () => {
      if (cancelled) return
      if (inFlight) { queued = true; return }
      inFlight = true
      window.clearTimeout(debounce)
      debounce = undefined
      try {
        const { data, error: queryError } = await client.rpc('admin_revenue_dashboard')
        if (cancelled) return
        if (queryError) throw queryError
        const result = Array.isArray(data) ? data[0] : data
        const next: RevenueDashboard = {
          month_total_cents: Number(result?.month_total_cents ?? 0),
          today_total_cents: Number(result?.today_total_cents ?? 0),
          subscription_total_cents: Number(result?.subscription_total_cents ?? 0),
          transaction_fee_total_cents: Number(result?.transaction_fee_total_cents ?? 0),
          refund_total_cents: Number(result?.refund_total_cents ?? 0),
          recent_events: Array.isArray(result?.recent_events) ? result.recent_events.map((event: RevenueEvent) => ({ ...event, amount_cents: Number(event.amount_cents) })) : [],
        }
        const currentMonth = month(new Date())
        const confirmed = next.recent_events.filter(event => {
          const receivedAt = pending.get(event.id)
          return receivedAt !== undefined && Date.now() - receivedAt < 15_000
            && event.amount_cents > 0 && event.currency === 'eur'
            && (event.kind === 'transaction_fee' || event.kind === 'subscription')
            && month(new Date(event.occurred_at)) === currentMonth
        })
        const delta = previous ? next.month_total_cents - previous.data.month_total_cents : 0
        if (previous && previous.month === currentMonth && delta > 0 && confirmed.length && visible()) {
          setNotice({ id: ++sequence.current, eventIds: confirmed.map(event => event.id),
            from: previous.data.month_total_cents, to: next.month_total_cents, delta })
        } else if (delta < 0 || previous?.month !== currentMonth) setNotice(null)
        for (const event of next.recent_events) pending.delete(event.id)
        for (const [id, receivedAt] of pending) if (Date.now() - receivedAt >= 15_000) pending.delete(id)
        previous = { data: next, month: currentMonth }
        setRevenue(next)
        setError('')
        setStale(false)
      } catch {
        if (!cancelled && !previous) setError('Tulude andmeid ei õnnestunud laadida. Proovi uuesti.')
        if (!cancelled) setStale(true)
      } finally {
        inFlight = false
        if (!cancelled) {
          setLoading(false)
          if (queued) { queued = false; void load() }
        }
      }
    }
    refreshRef.current = () => { void load() }
    const channel = client.channel(`admin-revenue-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'revenue_events' }, payload => {
        const id = payload.new.id
        if (typeof id !== 'string' || seen.has(id)) return
        seen.add(id)
        if (seen.size > 256) seen.delete(seen.values().next().value!)
        // The dashboard RPC excludes test payments; only its confirmed rows can celebrate.
        if (previous && visible()) pending.set(id, Date.now())
        if (inFlight) queued = true
        else if (debounce === undefined) debounce = window.setTimeout(() => { debounce = undefined; void load() }, 120)
      })
      .subscribe(status => {
        if (cancelled) return
        setLive(status === 'SUBSCRIBED')
        setStale(true)
        if (status === 'SUBSCRIBED') void load()
      })
    const onOffline = () => { pending.clear(); setNotice(null); setLive(false); setStale(true) }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') { pending.clear(); setNotice(null) }
      else void load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', refresh)
    void load()
    return () => {
      cancelled = true
      refreshRef.current = () => {}
      window.clearTimeout(debounce)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', refresh)
      void client.removeChannel(channel)
    }
  }, [userId])

  return { revenue, error, loading, stale, live, notice, refresh }
}
