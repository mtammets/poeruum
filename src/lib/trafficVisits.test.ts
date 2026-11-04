import { describe, expect, it } from 'vitest'
import { combineTrafficVisits } from './trafficVisits'
import type { DirectoryMetrics } from './directoryAnalyticsAdmin'

const homepage = {
  sessions: 60,
  daily: ['2026-09-20', '2026-09-21', '2026-09-22'].map((date, index) => ({ date, sessions: (index + 1) * 10, signup_starts: 0, accounts_created: 0 })),
}
const directory = {
  current: { visits: 8 } as DirectoryMetrics,
  // The tracking start is September 21 in Estonia, although the UTC date is September 20.
  tracking_started_at: '2026-09-20T22:30:00Z',
  daily: [
    { date: '2026-09-22', visits: 8, impressions: 100, store_clicks: 20, product_clicks: 30 },
    { date: '2026-09-20', visits: 0, impressions: 0, store_clicks: 0, product_clicks: 0 },
    { date: '2026-09-21', visits: 0, impressions: 0, store_clicks: 0, product_clicks: 0 },
  ],
}

describe('combined Poeruum and Kaubamaja visits', () => {
  it('adds site sessions, aligns history by date and preserves measured zero versus unmeasured days', () => {
    const result = combineTrafficVisits(homepage, directory)
    expect(result).toMatchObject({ total: 68, poeruum: 60, kaubamaja: 8 })
    expect(result.daily).toEqual([
      { date: '2026-09-20', poeruum: 10, kaubamaja: null },
      { date: '2026-09-21', poeruum: 20, kaubamaja: 0 },
      { date: '2026-09-22', poeruum: 30, kaubamaja: 8 },
    ])
  })
  it('does not fill missing historical days with invented zero visits', () => {
    expect(combineTrafficVisits(homepage, { ...directory, daily: [] }).daily.every((day) => day.kaubamaja === null)).toBe(true)
  })
  it('rejects unavailable totals or tracking dates instead of displaying a partial total', () => {
    expect(() => combineTrafficVisits(homepage, { ...directory, tracking_started_at: '' })).toThrow()
    expect(() => combineTrafficVisits(homepage, { ...directory, current: {} as DirectoryMetrics })).toThrow()
  })
})
