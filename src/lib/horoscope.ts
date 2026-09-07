import { parseDailyHoroscope, tallinnDate, type DailyHoroscope } from '../../supabase/functions/_shared/horoscope'
import { supabase } from './supabase'

let pending: { date: string; request: Promise<DailyHoroscope | null> } | null = null

export const loadDailyHoroscope = (date = tallinnDate()) => {
  if (pending?.date === date) return pending.request
  const request = (async () => {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('daily_horoscopes').select('date, entries').eq('date', date).maybeSingle()
        const horoscope = !error ? parseDailyHoroscope(data, date) : null
        if (horoscope) return horoscope
      } catch { /* A dated static edition also works during a backend outage. */ }
    }
    try {
      const response = await fetch('/data/daily-horoscope.json', { cache: 'no-cache' })
      return response.ok ? parseDailyHoroscope(await response.json(), date) : null
    } catch { return null }
  })().finally(() => { if (pending?.request === request) pending = null })
  pending = { date, request }
  return request
}
