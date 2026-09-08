import { useEffect, useState } from 'react'
import { isZodiacSign, tallinnDate, zodiacSigns, type DailyHoroscope as Horoscope, type ZodiacSign } from '../supabase/functions/_shared/horoscope'
import { loadDailyHoroscope } from './lib/horoscope'
import './dailyHoroscope.css'

const preferenceKey = 'poeruum:horoscope-sign'
const zodiacPaths: Record<ZodiacSign, string> = {
  aries: 'M16 27V12C16 3 5 3 5 10c0 3 2 5 4 5M16 12c0-9 11-9 11-2 0 3-2 5-4 5',
  taurus: 'M5 4c0 6 5 9 11 9S27 10 27 4M24 21a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  gemini: 'M6 4c6 3 14 3 20 0M6 28c6-3 14-3 20 0M11 6v20M21 6v20',
  cancer: 'M12 11a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 11c0-7 14-9 23-4M20 21a4 4 0 1 1 8 0 4 4 0 0 1-8 0M28 21c0 7-14 9-23 4',
  leo: 'M12 21a4 4 0 1 1-8 0 4 4 0 0 1 8 0M11 18C4 6 13 1 19 5c8 5-1 14-1 19 0 5 7 5 10 0',
  virgo: 'M3 9v16M3 13c0-7 7-7 7 0v12M10 13c0-7 7-7 7 0v9c0 5 5 7 11 7M17 14c6-10 15-3 8 5l-10 9',
  libra: 'M4 21h8v-2a7 7 0 1 1 8 0v2h8M4 27h24',
  scorpio: 'M3 9v16M3 13c0-7 7-7 7 0v12M10 13c0-7 7-7 7 0v8c0 6 5 7 11 0M24 21h4v4',
  sagittarius: 'M6 26 26 6M14 6h12v12M6 15l11 11',
  capricorn: 'M3 10c2-5 6-5 8 0l5 13M11 10c0-6 8-7 8 0 0 8-7 13-7 17M17 22c0-10 12-10 12-3 0 7-8 8-12 3',
  aquarius: 'm3 12 5-5 5 5 5-5 5 5 6-5M3 24l5-5 5 5 5-5 5 5 6-5',
  pisces: 'M7 4c7 6 7 18 0 24M25 4c-7 6-7 18 0 24M4 16h24',
}

const ZodiacIcon = ({ sign }: { sign: ZodiacSign }) => <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <path d={zodiacPaths[sign]} />
</svg>

const readSign = (): ZodiacSign => {
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

  return <section className="daily-horoscope" aria-labelledby="daily-horoscope-heading">
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
        <div id="daily-horoscope-reading" className="daily-horoscope__text" aria-live="polite" aria-atomic="true" aria-busy={isLoading}>
          <span className="daily-horoscope__sr-only">{selectedSign.name}. </span>
          <p key={`${date}-${sign}`}>{horoscope ? horoscope.entries[sign]
            : isLoading ? 'Laadin tänast horoskoopi…'
              : 'Tänane horoskoop pole veel saadaval. Vaata mõne aja pärast uuesti.'}</p>
        </div>
      </div>
    </div>
  </section>
}
