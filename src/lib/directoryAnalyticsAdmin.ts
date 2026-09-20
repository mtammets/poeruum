import { requireSupabase } from './supabase'

export type DirectoryMetrics = {
  visits: number; impressions: number; store_clicks: number; product_clicks: number
  outbound_visits: number; searches: number; empty_searches: number
  average_position: number | null; ctr: number | null
}
export type DirectoryStoreStats = {
  id: string; name: string; slug: string | null; is_published: boolean; position: number | null
  current: DirectoryMetrics; previous: DirectoryMetrics
}
export type DirectoryReport = {
  range_days: number; from_date: string; to_date: string; previous_from_date: string; previous_to_date: string
  tracking_started_at: string; comparison_available: boolean
  store: { id: string; name: string } | null
  current: DirectoryMetrics; previous: DirectoryMetrics
  daily: { date: string; visits: number; impressions: number; store_clicks: number; product_clicks: number }[]
  sources: { label: string; visits: number }[]; devices: { label: string; visits: number }[]
  stores: DirectoryStoreStats[]
  products: { id: string; name: string; clicks: number; previous_clicks: number }[]
  placements: { placement: string; impressions: number; clicks: number; average_position: number | null }[]
}
export async function loadDirectoryReport(days: number, storeId: string | null): Promise<DirectoryReport> {
  const { data, error } = await requireSupabase().rpc('admin_directory_analytics', {
    requested_days: days, requested_store_id: storeId,
  })
  if (error || !data?.current || !Array.isArray(data.daily) || !Array.isArray(data.stores)) {
    throw new Error(error?.code === '42501' ? 'Statistika vaatamiseks on vaja administraatori õigusi.'
      : 'Kaubamaja statistikat ei õnnestunud laadida. Proovi uuesti.')
  }
  return data as DirectoryReport
}
