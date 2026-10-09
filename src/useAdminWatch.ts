import { useEffect, useRef, useState } from 'react'
import type { HomepageAnalyticsDashboard, RevenueDashboard } from './lib/adminDashboard'
import type { AdminUserRow } from './lib/adminUserOverview'
import type { RevenueNotice } from './useAdminRevenue'
import { queueWatchEvents, userWatchEvents, watchDay, watchPriority, watchScene, type WatchEvent, type WatchScene } from './lib/adminWatch'

type Props = {
  enabled: boolean
  onDisable: () => void
  initialScene: WatchScene
  scope: string
  rows: AdminUserRow[]
  usersReady: boolean
  analytics: HomepageAnalyticsDashboard
  analyticsReady: boolean
  revenue: RevenueDashboard
  revenueNotice: RevenueNotice | null
  revenueReady: boolean
}
type Presentation = { scene: WatchScene; event: WatchEvent | null; key: number; until: number; started: number }
const scenes: WatchScene[] = ['analytics', 'users', 'income']
const editingTarget = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"]'

export default function useAdminWatch(props: Props) {
  const [active, setActive] = useState(false)
  const [visible, setVisible] = useState(() => !document.hidden)
  const [presentation, setPresentation] = useState<Presentation>({ scene: 'analytics', event: null, key: 0, until: 0, started: 0 })
  const latest = useRef(props)
  latest.current = props
  const currentPresentation = useRef(presentation)
  currentPresentation.current = presentation
  const queue = useRef<WatchEvent[]>([])
  const seen = useRef(new Set<string>())
  const sequence = useRef(0)
  const users = useRef<{ rows: AdminUserRow[]; at: number } | null>(null)
  const visits = useRef<{ count: number; scope: string } | null>(null)
  const lastRevenueNotice = useRef<number | undefined>(undefined)

  useEffect(() => {
    queue.current = []
    seen.current.clear()
    users.current = null
    visits.current = null
    lastRevenueNotice.current = latest.current.revenueNotice?.id
  }, [props.enabled, props.scope, visible])

  useEffect(() => {
    if (!props.enabled || !visible) return
    const now = Date.now()
    const events: WatchEvent[] = []
    if (props.usersReady) {
      if (users.current?.rows !== props.rows) {
        if (users.current) events.push(...userWatchEvents(users.current.rows, props.rows, users.current.at, now))
        // Keep the first snapshot time: a signup can commit while a previous
        // request is in flight and only appear in the following response.
        users.current = { rows: props.rows, at: users.current?.at ?? now }
      }
    } else users.current = null
    if (props.analyticsReady) {
      const day = watchDay(now)
      const scope = `${props.scope}:${props.analytics.range_days}:${day}`
      const count = props.analytics.daily.find((point) => point.date === day)?.sessions ?? 0
      const previous = visits.current
      if (previous?.scope === scope && count > previous.count) events.push({ id: `visit:${++sequence.current}`, kind: 'visit', at: now, title: 'Avalehe külastused', detail: 'Poeruum.ee', count: count - previous.count })
      visits.current = { scope, count }
    } else visits.current = null
    const notice = props.revenueNotice
    if (notice && notice.id !== lastRevenueNotice.current && props.revenueReady) {
      const confirmed = props.revenue.recent_events.filter((event) => notice.eventIds.includes(event.id)
        && event.amount_cents > 0 && event.currency === 'eur' && ['subscription', 'transaction_fee'].includes(event.kind))
      if (confirmed.length) events.push({ id: `income:${confirmed.map((event) => event.id).sort().join(':')}`, kind: 'income', at: now,
        title: 'Poeruumi teenustasu', detail: confirmed.length === 1 ? confirmed[0].store_name : `${confirmed.length} laekumist`,
        amount: confirmed.reduce((sum, event) => sum + event.amount_cents, 0), revenueIds: confirmed.map((event) => event.id) })
    }
    lastRevenueNotice.current = notice?.id
    const fresh = events.filter((event) => !seen.current.has(event.id))
    fresh.forEach((event) => seen.current.add(event.id))
    if (seen.current.size > 512) seen.current.delete(seen.current.values().next().value!)
    queue.current = queueWatchEvents(queue.current, fresh, now)
  }, [props.enabled, props.scope, visible, props.rows, props.usersReady, props.analytics, props.analyticsReady, props.revenue, props.revenueNotice, props.revenueReady])

  useEffect(() => {
    if (!props.enabled) { setActive(false); return }
    let timer: number | undefined
    let watching = false
    let previousFocus: HTMLElement | null = null
    let pointer: { x: number; y: number } | null = null
    let suppressClickUntil = 0
    let pointerDown = false
    const blocked = () => document.hidden || pointerDown || Boolean(document.activeElement?.matches(editingTarget))
      || Boolean(document.querySelector('dialog[open], [aria-modal="true"]:not(.admin-watch-screen), .admin-story-deck[data-motion], details[open]'))
      || Boolean(window.getSelection()?.toString())
    const arm = () => {
      window.clearTimeout(timer)
      if (document.hidden) return
      timer = window.setTimeout(() => {
        if (blocked()) return
        watching = true
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const now = Date.now()
        setPresentation({ scene: latest.current.initialScene, event: null, key: ++sequence.current, until: now + 16_000, started: now })
        setActive(true)
      }, 3000)
    }
    const wake = () => {
      if (watching) {
        watching = false
        setActive(false)
        // Restore after React removes inert from the working surface.
        window.requestAnimationFrame(() => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) })
      }
      arm()
    }
    const activity = (event: Event) => {
      if (event.type === 'focusout' && watching) return
      if (event.target instanceof Element && event.target.closest('[data-watch-control]')) return
      if (event instanceof PointerEvent && event.type === 'pointermove') {
        if (pointer && Math.abs(event.clientX - pointer.x) + Math.abs(event.clientY - pointer.y) < 3) return
        pointer = { x: event.clientX, y: event.clientY }
      }
      if (event.type === 'pointerdown') pointerDown = true
      if (event.type === 'pointerup' || event.type === 'pointercancel') pointerDown = false
      if (watching && ['pointerdown', 'keydown', 'wheel', 'touchstart'].includes(event.type)) {
        if (event.cancelable) event.preventDefault()
        event.stopImmediatePropagation()
        suppressClickUntil = Date.now() + 600
      }
      if (watching && event instanceof KeyboardEvent && event.key === 'Escape') latest.current.onDisable()
      wake()
    }
    const click = (event: MouseEvent) => {
      if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    const visibility = () => {
      setVisible(!document.hidden)
      wake()
    }
    const events = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'keydown', 'wheel', 'touchstart', 'focusout']
    events.forEach((name) => window.addEventListener(name, activity, { capture: true, passive: false }))
    window.addEventListener('click', click, true)
    document.addEventListener('visibilitychange', visibility)
    arm()
    return () => {
      window.clearTimeout(timer)
      events.forEach((name) => window.removeEventListener(name, activity, true))
      window.removeEventListener('click', click, true)
      document.removeEventListener('visibilitychange', visibility)
      if (watching) window.requestAnimationFrame(() => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) })
    }
  }, [props.enabled])

  useEffect(() => {
    if (!active || !visible) return
    const step = () => {
      const now = Date.now()
      queue.current = queueWatchEvents(queue.current, [], now)
      const current = currentPresentation.current
      const nextPresentation = (() => {
        const next = queue.current[0]
        const preempt = next && current.event && watchPriority(next) > watchPriority(current.event) && now - current.started >= 2000
        if (next && (!current.event || now >= current.until || preempt)) {
          queue.current.shift()
          return { scene: watchScene(next), event: next, key: ++sequence.current, started: now, until: now + (next.kind === 'visit' ? 5000 : 9000) }
        }
        if (now < current.until) return current
        const scene = current.event ? current.scene : scenes[(scenes.indexOf(current.scene) + 1) % scenes.length]
        return { scene, event: null, key: ++sequence.current, started: now, until: now + 16_000 }
      })()
      currentPresentation.current = nextPresentation
      setPresentation(nextPresentation)
    }
    const timer = window.setInterval(step, 250)
    step()
    return () => window.clearInterval(timer)
  }, [active, visible])

  return { active: active && props.enabled, ...presentation }
}
