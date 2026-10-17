import { useEffect, useState } from 'react'
import { isZodiacSign, tallinnDate, zodiacSigns, type DailyHoroscope as Horoscope, type ZodiacSign } from '../supabase/functions/_shared/horoscope'
import { zodiacPaths } from '../supabase/functions/_shared/zodiac.mjs'
import { loadDailyHoroscope } from './lib/horoscope'
import './dailyHoroscope.css'

const preferenceKey = 'poeruum:horoscope-sign'
const ZodiacIcon = ({ sign }: { sign: ZodiacSign }) => <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <path d={zodiacPaths[sign]} />
</svg>

const readSign = (): ZodiacSign => {
  const sharedSign = new URLSearchParams(window.location.search).get('horoskoop')
  if (isZodiacSign(sharedSign)) return sharedSign
  try {
    const value = window.localStorage.getItem(preferenceKey)
    return isZodiacSign(value) ? value : 'aries'
  } catch { return 'aries' }
}

export default function DailyHoroscope() {
  const [horoscope, setHoroscope] = useState<Horoscope | null>(null)
  const [date, setDate] = useState(tallinnDate)
  const [isLoading, setIsLoading] = useState(true)
  const [sign, setSign] = useState<ZodiacSign>(readSign)
  const [isSharing, setIsSharing] = useState(false)
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'error'>('idle')

  useEffect(() => {
    if (shareStatus === 'idle') return
    const timer = window.setTimeout(() => setShareStatus('idle'), 3000)
    return () => window.clearTimeout(timer)
  }, [shareStatus])

  useEffect(() => {
    let active = true
    let requestedDate = ''
    let requestId = 0
    const refresh = async () => {
      const date = tallinnDate()
      if (date === requestedDate) return
      requestedDate = date
      const id = ++requestId
      setDate(date)
      setIsLoading(true)
      setHoroscope(null)
      const next = await loadDailyHoroscope(date)
      if (active && id === requestId) {
        setHoroscope(next)
        setIsLoading(false)
        if (!next) requestedDate = ''
      }
    }
    void refresh()
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 60_000)
    const onVisible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  const dateLabel = new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'long', timeZone: 'Europe/Tallinn' })
    .format(new Date(`${date}T12:00:00Z`))
  const selectedSign = zodiacSigns.find((item) => item.id === sign)!

  const shareHoroscope = async (copyOnly = false) => {
    if (!horoscope || isSharing) return
    const url = new URL('/', window.location.origin)
    url.searchParams.set('horoskoop', sign)
    url.hash = 'horoskoop'
    const title = `${selectedSign.name} · ${dateLabel} · Poeruumi horoskoop`
    setIsSharing(true)
    setShareStatus('idle')
    try {
      if (!copyOnly && navigator.share) {
        try {
          await navigator.share({ title, url: url.href })
          return
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return
        }
      }
      await navigator.clipboard.writeText(url.href)
      setShareStatus('copied')
    } catch {
      setShareStatus('error')
    } finally {
      setIsSharing(false)
    }
  }

  return <section id="horoskoop" className="daily-horoscope" aria-labelledby="daily-horoscope-heading">
    <header className="daily-horoscope__section-heading">
      <h2 id="daily-horoscope-heading">Horoskoop</h2>
    </header>
    <div className="daily-horoscope__card">
      <div className="daily-horoscope__signs" role="radiogroup" aria-label="Vali tähemärk">
        {zodiacSigns.map((item) => <label className="daily-horoscope__sign" key={item.id}>
          <input
            type="radio"
            name="horoscope-sign"
            value={item.id}
            checked={sign === item.id}
            aria-controls="daily-horoscope-reading"
            onChange={() => {
              setSign(item.id)
              setShareStatus('idle')
              const url = new URL(window.location.href)
              if (url.searchParams.has('horoskoop')) {
                url.searchParams.set('horoskoop', item.id)
                window.history.replaceState(window.history.state, '', url)
              }
              try { window.localStorage.setItem(preferenceKey, item.id) } catch { /* Selection still works without storage. */ }
            }}
          />
          <span className="daily-horoscope__sign-symbol"><ZodiacIcon sign={item.id} /></span>
          <span className="daily-horoscope__sign-name">{item.name}</span>
        </label>)}
      </div>
      <div className="daily-horoscope__reading">
        <div className="daily-horoscope__heading">
          <span className="daily-horoscope__emblem"><ZodiacIcon sign={sign} /></span>
          <div>
            <h3>{selectedSign.name}</h3>
            <time dateTime={date}>{dateLabel}</time>
          </div>
        </div>
        <div className="daily-horoscope__content">
          <div id="daily-horoscope-reading" className="daily-horoscope__text" aria-live="polite" aria-atomic="true" aria-busy={isLoading}>
            <span className="daily-horoscope__sr-only">{selectedSign.name}. </span>
            <p key={`${date}-${sign}`}>{horoscope ? horoscope.entries[sign]
              : isLoading ? 'Laadin tänast horoskoopi…'
                : 'Tänane horoskoop pole veel saadaval. Vaata mõne aja pärast uuesti.'}</p>
          </div>
          <div className="daily-horoscope__actions">
            <button className="daily-horoscope__share" type="button" disabled={!horoscope || isSharing} onClick={() => void shareHoroscope()}>
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 16V3m-4 4 4-4 4 4M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
              </svg>
              <span>Jaga</span>
            </button>
            <button className="daily-horoscope__share" type="button" disabled={!horoscope || isSharing} onClick={() => void shareHoroscope(true)}>
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                {shareStatus === 'copied' ? <path d="m5 12 4 4L19 6" /> : <><path d="M9 7V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3" /><rect x="3" y="7" width="14" height="14" rx="1" /></>}
              </svg>
              <span aria-live="polite">{shareStatus === 'copied' ? 'Link kopeeritud' : shareStatus === 'error' ? 'Proovi uuesti' : 'Kopeeri link'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
}
