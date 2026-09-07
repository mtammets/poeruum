export const zodiacSigns = [
  { id: 'aries', name: 'Jäär' },
  { id: 'taurus', name: 'Sõnn' },
  { id: 'gemini', name: 'Kaksikud' },
  { id: 'cancer', name: 'Vähk' },
  { id: 'leo', name: 'Lõvi' },
  { id: 'virgo', name: 'Neitsi' },
  { id: 'libra', name: 'Kaalud' },
  { id: 'scorpio', name: 'Skorpion' },
  { id: 'sagittarius', name: 'Ambur' },
  { id: 'capricorn', name: 'Kaljukits' },
  { id: 'aquarius', name: 'Veevalaja' },
  { id: 'pisces', name: 'Kalad' },
] as const

export type ZodiacSign = typeof zodiacSigns[number]['id']
export type DailyHoroscope = {
  date: string
  entries: Record<ZodiacSign, string>
}

export const tallinnDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now)

export const nextHoroscopeDate = (date: string) => {
  const tomorrow = new Date(`${date}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return tomorrow.toISOString().slice(0, 10)
}

export const isZodiacSign = (value: unknown): value is ZodiacSign => zodiacSigns.some((sign) => sign.id === value)

export const parseDailyHoroscope = (value: unknown, date: string): DailyHoroscope | null => {
  if (!value || typeof value !== 'object' || !('date' in value) || value.date !== date || !('entries' in value)) return null
  const entries = value.entries
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return null
  if (Object.keys(entries).length !== zodiacSigns.length) return null
  const normalized = {} as DailyHoroscope['entries']
  for (const sign of zodiacSigns) {
    const text = (entries as Record<string, unknown>)[sign.id]
    if (typeof text !== 'string') return null
    const clean = text.replace(/\s+/g, ' ').trim()
    if (clean.length < 40 || clean.length > 360 || /[<>]|https?:\/\//i.test(clean)) return null
    normalized[sign.id] = clean
  }
  return { date, entries: normalized }
}
