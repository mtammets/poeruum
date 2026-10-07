import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RevenueNotice } from './useAdminRevenue'
import useRevenueSound from './useRevenueSound'
import './revenueFeedback.css'

export const revenueMoney = (cents: number, currency = 'eur') => new Intl.NumberFormat('et-EE', {
  style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 2, minimumFractionDigits: cents % 100 ? 2 : 0,
}).format(cents / 100)

export function RevenueAmount({ value, notice }: { value: number | null; notice: RevenueNotice | null }) {
  const [displayed, setDisplayed] = useState(value ?? 0)
  const current = useRef(value ?? 0)
  const running = useRef(false)

  useLayoutEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const finish = () => {
      cancelAnimationFrame(frame)
      running.current = false
      current.current = value ?? 0
      setDisplayed(current.current)
    }
    if (value === null || !notice || notice.to !== value || motion.matches) { finish(); return }
    const from = running.current ? current.current : notice.from
    const started = performance.now()
    running.current = true
    current.current = from
    setDisplayed(from)
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / 950)
      current.current = Math.round(from + (value - from) * (1 - (1 - progress) ** 4))
      setDisplayed(current.current)
      if (progress < 1) frame = requestAnimationFrame(step)
      else running.current = false
    }
    frame = requestAnimationFrame(step)
    motion.addEventListener('change', finish)
    return () => { cancelAnimationFrame(frame); motion.removeEventListener('change', finish) }
  }, [value, notice])

  const amount = value === null ? '—' : revenueMoney(notice?.to === value ? displayed : value)
  return <div className="overview-income__amount" role="group" aria-label={value === null ? 'Laen teenustasusid' : `Teenustasusid ${revenueMoney(value)}`}>
    <span key={notice?.id ?? 'idle'} className={notice ? 'revenue-number is-arriving' : 'revenue-number'} aria-hidden="true">{amount}</span>
  </div>
}

export function RevenueSound({ notice }: { notice: RevenueNotice | null }) {
  const sound = useRevenueSound()
  const played = useRef<number | null>(null)
  useEffect(() => {
    if (!notice || played.current === notice.id) return
    played.current = notice.id
    if (sound.enabled) sound.play()
  }, [notice, sound.enabled, sound.play])
  return <button type="button" className="revenue-sound" aria-label="Laekumiste heli" aria-pressed={sound.enabled}
    disabled={sound.unavailable} onClick={sound.toggle}
    title={sound.unavailable ? 'Heli pole selles brauseris saadaval' : sound.enabled ? 'Lülita laekumiste heli välja' : 'Lülita laekumiste heli sisse'}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" />
      {sound.enabled ? <><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></> : <path d="m16 9 5 6m0-6-5 6" />}
    </svg>
  </button>
}

export function RevenueCelebration({ notice }: { notice: RevenueNotice | null }) {
  return notice && <div key={notice.id} className="revenue-celebration" aria-hidden="true"><i /><b /></div>
}

export function RevenueDelta({ notice }: { notice: RevenueNotice | null }) {
  return <span className="revenue-announcement" role="status" aria-live="polite" aria-atomic="true">
    {notice && <span key={notice.id} className="revenue-delta"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 11 11 3M4 3h7v7" /></svg>
      +{revenueMoney(notice.delta)}<span className="users-sr-only"> teenustasusid laekus. Kokku {revenueMoney(notice.to)}.</span>
    </span>}
  </span>
}
