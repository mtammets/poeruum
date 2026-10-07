import { useEffect, useState } from 'react'
import { loadDirectoryReport, type DirectoryReport } from './lib/directoryAnalyticsAdmin'
import { requireSupabase } from './lib/supabase'

export default function useStoreAttraction(days: number, retry: number) {
  const [state, setState] = useState<{ report: DirectoryReport | null; loading: boolean; error: boolean; live: boolean; updatedIds: string[] }>({ report: null, loading: true, error: false, live: false, updatedIds: [] })
  useEffect(() => {
    let active = true, inFlight = false, queued = false, connected = false, failed = false
    let debounce: number | undefined, flash: number | undefined
    let lastSuccess = 0
    let previous: DirectoryReport | null = null
    const controller = new AbortController()
    const client = requireSupabase()
    setState((current) => ({ ...current, report: current.report?.range_days === days ? current.report : null, loading: true, error: false, live: false, updatedIds: [] }))
    const refresh = async () => {
      if (!active || document.visibilityState !== 'visible') return
      if (!navigator.onLine) { failed = true; setState((current) => ({ ...current, loading: false, error: true, live: false })); return }
      if (inFlight) { queued = true; return }
      inFlight = true
      try {
        const report = await loadDirectoryReport(days, null, controller.signal)
        if (!active) return
        const oldCounts = new Map(previous?.stores.map((store) => [store.id, store.current.store_clicks]))
        const updatedIds = previous ? report.stores.filter((store) => store.current.store_clicks > (oldCounts.get(store.id) ?? 0)).map((store) => store.id) : []
        previous = report
        lastSuccess = Date.now()
        failed = false
        setState({ report, loading: false, error: false, live: connected, updatedIds })
        window.clearTimeout(flash)
        if (updatedIds.length) flash = window.setTimeout(() => { if (active) setState((current) => ({ ...current, updatedIds: [] })) }, 1400)
      } catch {
        failed = true
        if (active) setState((current) => ({ ...current, loading: false, error: true }))
      } finally {
        inFlight = false
        if (active && queued) { queued = false; schedule() }
      }
    }
    const schedule = () => {
      if (debounce !== undefined) return
      debounce = window.setTimeout(() => { debounce = undefined; void refresh() }, 120)
    }
    const channel = client.channel(`admin-attraction-${days}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'admin_directory_refresh' }, schedule)
      .subscribe((status) => {
        if (!active) return
        connected = status === 'SUBSCRIBED'
        setState((current) => ({ ...current, live: connected }))
        // Catch events committed between the initial read and subscription acknowledgement.
        if (connected) schedule()
      })
    void refresh()
    // Recovery and calendar rollover only; committed events drive normal updates.
    const timer = window.setInterval(() => { if (!connected || failed || Date.now() - lastSuccess >= 60_000) void refresh() }, 15_000)
    const onVisible = () => { if (document.visibilityState === 'visible') schedule() }
    const onOffline = () => { connected = false; setState((current) => ({ ...current, live: false })) }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', onVisible)
    window.addEventListener('offline', onOffline)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(timer)
      window.clearTimeout(debounce)
      window.clearTimeout(flash)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('online', onVisible)
      window.removeEventListener('offline', onOffline)
      void client.removeChannel(channel)
    }
  }, [days, retry])
  return { ...state, report: state.report?.range_days === days ? state.report : null }
}
