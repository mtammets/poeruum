import type { AnalyticsDailyPoint, TrafficVisits } from './adminDashboard'
import type { DirectoryReport } from './directoryAnalyticsAdmin'

const estonianDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit' })

// Keep each site's session count independent: these are visits, not deduplicated people.
// Existing directory events provide history without copying or inventing events.
export function combineTrafficVisits(homepage: { sessions: number; daily: AnalyticsDailyPoint[] }, directory: Pick<DirectoryReport, 'current' | 'daily' | 'tracking_started_at'>): TrafficVisits {
  const start = Date.parse(directory.tracking_started_at)
  if (!Number.isFinite(start) || !Number.isFinite(directory.current.visits)) throw new Error('Kaubamaja külastuste andmed on puudulikud.')
  const firstDay = estonianDay.format(start)
  const directoryDays = new Map(directory.daily.map((day) => [day.date, day.visits]))
  return {
    total: homepage.sessions + directory.current.visits,
    poeruum: homepage.sessions,
    kaubamaja: directory.current.visits,
    kaubamaja_started_at: directory.tracking_started_at,
    daily: homepage.daily.map((day) => ({
      date: day.date,
      poeruum: day.sessions,
      kaubamaja: day.date < firstDay ? null : directoryDays.get(day.date) ?? null,
    })),
  }
}
