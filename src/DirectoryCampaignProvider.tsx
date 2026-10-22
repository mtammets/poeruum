import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { DirectoryThemeContext, directoryPreviewTheme } from './lib/directoryTheme'
import { campaignStatus, loadDirectoryCampaign, nextCampaignBoundary, type DirectoryCampaign } from './lib/directoryCampaign'
import { hasAdminRole } from './lib/adminAccess'
import { supabase } from './lib/supabase'

export default function DirectoryCampaignProvider({ children }: { children: ReactNode }) {
  const [verifiedAdmin, setVerifiedAdmin] = useState(false)
  const [sample, setSample] = useState<{ campaign: DirectoryCampaign; receivedAt: number } | null>(null)
  const [tick, setTick] = useState(0)
  const [checkoutCount, setCheckoutCount] = useState(0)
  const keepCampaignVisible = useCallback(() => {
    setCheckoutCount(count => count + 1)
    let released = false
    return () => { if (!released) { released = true; setCheckoutCount(count => count - 1) } }
  }, [])
  const preview = directoryPreviewTheme(window.location.search, import.meta.env.DEV, verifiedAdmin)

  useEffect(() => {
    if (import.meta.env.DEV || !supabase || !new URLSearchParams(window.location.search).has('theme')) return
    const client = supabase
    let active = true
    let generation = 0
    let timer = 0
    const verify = async () => {
      const request = ++generation
      try {
        const { data, error } = await client.auth.getUser()
        if (active && request === generation) setVerifiedAdmin(!error && !!data.user && hasAdminRole(data.user))
      } catch { if (active && request === generation) setVerifiedAdmin(false) }
    }
    void verify()
    const { data: { subscription } } = client.auth.onAuthStateChange(event => {
      window.clearTimeout(timer)
      if (event === 'SIGNED_OUT') { generation++; setVerifiedAdmin(false) }
      else timer = window.setTimeout(() => { void verify() }, 0)
    })
    return () => { active = false; window.clearTimeout(timer); subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (preview || !supabase) return
    let active = true
    let request: AbortController | null = null
    const refresh = async () => {
      if (request) return
      request = new AbortController()
      const timeout = window.setTimeout(() => request?.abort(), 5000)
      try {
        const campaign = await loadDirectoryCampaign(request.signal)
        if (active) setSample({ campaign, receivedAt: performance.now() })
      } catch {
        // An unavailable/missing campaign setting must never enable the promotion.
        if (active) setSample(null)
      } finally { window.clearTimeout(timeout); request = null }
    }
    const wake = () => {
      if (document.visibilityState === 'hidden') return
      setTick(value => value + 1)
      void refresh()
    }
    void refresh()
    const poll = window.setInterval(wake, 30000)
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      active = false; request?.abort(); window.clearInterval(poll)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [preview])

  // Advance from the database clock with a monotonic timer, not the visitor's wall clock.
  const now = sample ? Date.parse(sample.campaign.serverNow) + performance.now() - sample.receivedAt : 0
  const boundary = nextCampaignBoundary(sample?.campaign ?? null, now)
  useEffect(() => {
    if (preview || boundary === null) return
    const timer = window.setTimeout(() => setTick(value => value + 1), Math.min(86400000, Math.max(1, boundary - now)))
    return () => window.clearTimeout(timer)
  }, [preview, boundary, now, tick])
  // Keep a buyer's entered details mounted until they finish or close checkout.
  const theme = checkoutCount > 0 ? 'black-friday' : preview ?? (campaignStatus(sample?.campaign ?? null, now) === 'active' ? 'black-friday' : 'default')
  return <DirectoryThemeContext.Provider value={{ theme, canPreview: import.meta.env.DEV || verifiedAdmin, preview, keepCampaignVisible }}>
    {children}
  </DirectoryThemeContext.Provider>
}
