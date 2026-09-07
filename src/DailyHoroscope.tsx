import { useEffect, useState } from 'react'
import { isZodiacSign, tallinnDate, zodiacSigns, type DailyHoroscope as Horoscope, type ZodiacSign } from '../supabase/functions/_shared/horoscope'
import { loadDailyHoroscope } from './lib/horoscope'
import './dailyHoroscope.css'

const preferenceKey = 'poeruum:horoscope-sign'
const readSign = (): ZodiacSign => {
  try {
    const value = window.localStorage.getItem(preferenceKey)
    return isZodiacSign(value) ? value : 'aries'
  } catch { return 'aries' }
}

export default function DailyHoroscope() {
  const [horoscope, setHoroscope] = useState<Horoscope | null>(null)
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
      setHoroscope(null)
      const next = await loadDailyHoroscope(date)
      if (active && id === requestId) {
        setHoroscope(next)
        if (!next) requestedDate = ''
      }
    }
    void refresh()
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 60_000)
    const onVisible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  if (!horoscope) return null
  const dateLabel = new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'long', timeZone: 'Europe/Tallinn' })
    .format(new Date(`${horoscope.date}T12:00:00Z`))

  return <section className="daily-horoscope" aria-labelledby="daily-horoscope-heading">
    <div className="daily-horoscope__heading">
      <svg className="daily-horoscope__sun" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <circle cx="32" cy="32" r="12" />
        <circle cx="32" cy="32" r="20" />
        <path d="M32 3v9m0 40v9M3 32h9m40 0h9M11.5 11.5l6.3 6.3m28.4 28.4 6.3 6.3m0-41-6.3 6.3M17.8 46.2l-6.3 6.3" />
      </svg>
      <div>
        <h2 id="daily-horoscope-heading">Päevahoroskoop</h2>
        <time dateTime={horoscope.date}>{dateLabel}</time>
      </div>
    </div>
    <div className="daily-horoscope__reading">
      <div className="daily-horoscope__select">
        <select aria-label="Tähemärk" value={sign} onChange={(event) => {
          const value = event.target.value
          if (!isZodiacSign(value)) return
          setSign(value)
          try { window.localStorage.setItem(preferenceKey, value) } catch { /* Selection still works without storage. */ }
        }}>
          {zodiacSigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
      </div>
      <div className="daily-horoscope__text" aria-live="polite" aria-atomic="true">
        <p key={sign}>{horoscope.entries[sign]}</p>
      </div>
    </div>
  </section>
}
