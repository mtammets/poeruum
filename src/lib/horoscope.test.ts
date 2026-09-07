import { describe, expect, it } from 'vitest'
import { nextHoroscopeDate, parseDailyHoroscope, tallinnDate, zodiacSigns } from '../../supabase/functions/_shared/horoscope'

const edition = {
  date: '2026-09-07',
  entries: Object.fromEntries(zodiacSigns.map((sign) => [sign.id, 'Jäta täna oma plaanidesse natuke vaba ruumi. Mõni ootamatu kohtumine võib päeva rõõmsamaks teha.'])),
}

describe('daily horoscope editions', () => {
  it('changes editions at Tallinn midnight in summer and winter', () => {
    expect(tallinnDate(new Date('2026-09-07T20:59:59Z'))).toBe('2026-09-07')
    expect(tallinnDate(new Date('2026-09-07T21:00:00Z'))).toBe('2026-09-08')
    expect(tallinnDate(new Date('2026-12-07T21:59:59Z'))).toBe('2026-12-07')
    expect(tallinnDate(new Date('2026-12-07T22:00:00Z'))).toBe('2026-12-08')
    expect(nextHoroscopeDate('2026-03-28')).toBe('2026-03-29')
    expect(nextHoroscopeDate('2026-10-24')).toBe('2026-10-25')
    expect(nextHoroscopeDate('2026-12-31')).toBe('2027-01-01')
  })

  it('only displays a complete edition for the requested day', () => {
    expect(parseDailyHoroscope(edition, edition.date)?.entries.aries).toBe(edition.entries.aries)
    expect(parseDailyHoroscope(edition, '2026-09-08')).toBeNull()
    expect(parseDailyHoroscope({ ...edition, entries: { aries: edition.entries.aries } }, edition.date)).toBeNull()
    expect(parseDailyHoroscope({ ...edition, entries: { ...edition.entries, aries: 'Lühike.' } }, edition.date)).toBeNull()
    expect(parseDailyHoroscope({ ...edition, entries: { ...edition.entries, aries: '<p>Jäta täna oma plaanidesse natuke vaba ruumi.</p>' } }, edition.date)).toBeNull()
    expect(parseDailyHoroscope({ ...edition, entries: { ...edition.entries, aries: 'x'.repeat(361) } }, edition.date)).toBeNull()
  })
})
