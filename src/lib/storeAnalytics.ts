import { requireSupabase } from './supabase'

export type StoreAnalyticsRange = 7 | 30
export type StoreAnalyticsMetric = 'visits' | 'orders' | 'sales'
export type StoreAnalyticsTotals = Record<StoreAnalyticsMetric, number>
export type StoreAnalyticsReport = {
  store_id: string
  range_days: StoreAnalyticsRange
  from_date: string
  to_date: string
  updated_at: string
  tracking_started_at: string
  comparison_available: boolean
  current: StoreAnalyticsTotals
  previous: StoreAnalyticsTotals
  daily: { date: string; visits: number | null; orders: number; sales: number }[]
  products: { id: string; name: string; image: string | null; views: number; daily: { date: string; views: number | null }[] }[]
  sources: { label: string; visits: number }[]
}

export async function fetchStoreAnalytics(storeId: string, days: StoreAnalyticsRange, signal: AbortSignal): Promise<StoreAnalyticsReport> {
  const { data, error } = await requireSupabase().rpc('merchant_store_analytics', { target_store_id: storeId, requested_days: days }).abortSignal(signal)
  if (error || !data) throw new Error('Statistikat ei õnnestunud laadida.')
  if (data.store_id !== storeId || data.range_days !== days) throw new Error('Statistika vastus ei vasta valitud poele või perioodile.')
  return data as StoreAnalyticsReport
}

export function storeAnalyticsTrend(current: number, previous: number, available: boolean) {
  if (!available) return null
  const direction = current > previous ? 'up' : current < previous ? 'down' : 'flat'
  const number = new Intl.NumberFormat('et-EE', { maximumFractionDigits: 0 })
  const precise = new Intl.NumberFormat('et-EE', { maximumFractionDigits: 2 })
  // Small samples need their actual counts, not impressive-looking percentages.
  const label = previous < 10 ? `${precise.format(previous)} → ${precise.format(current)}`
    : `${current > previous ? '+' : ''}${number.format((current - previous) / previous * 100)}%`
  return { direction, label }
}
