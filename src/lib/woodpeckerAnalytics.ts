import { requireSupabase } from './supabase'
import type { CampaignSurface } from '../../supabase/functions/_shared/woodpecker-analytics'
export type WoodpeckerRange = 'all' | 'today' | '24h' | '7d'
export type CampaignPlayer = {
  visitor_id: string; customer_name: string | null; games: number; hats: number; best: number
  seconds: number; last_seen: string; device: string; source: string; orders: number; sales: number
}
export type WoodpeckerReport = {
  starts_at: string; ends_at: string | null; tracking_started_at: string; from: string; to: string; updated_at: string; bucket: 'hour' | 'day'
  totals: { visits: number; players: number; games: number; hats: number; best: number; game_seconds: number; game_buyers: number; orders: number; sales: number; attributed_orders: number; refunds: number; active: number }
  surfaces: { surface: CampaignSurface; visits: number; visitors: number; clicks: number; product_views: number; checkouts: number; full_scrolls: number; seconds: number }[]
  timeline: { time: string; directory: number; homepage: number; store: number; measured: boolean }[]
  sources: { label: string; visits: number }[]; devices: { label: string; visits: number }[]
  actions: { label: string; events: number; sessions: number }[]
  products: { product_id: string; name: string | null; image: string | null; views: number; carts: number; clicks: number }[]
  utms: { source: string; campaign: string; visits: number }[]
  players: CampaignPlayer[]; player_count: number; player_page: number
}
export async function fetchWoodpeckerReport(range: WoodpeckerRange, page: number, search: string, signal: AbortSignal, asOf?: string): Promise<WoodpeckerReport> {
  const { data, error } = await requireSupabase().rpc('admin_woodpecker_analytics', {
    requested_range: range, player_page: page, player_search: search, as_of: asOf ?? null,
  }).abortSignal(signal)
  if (error || !data || !Array.isArray(data.surfaces) || !data.totals || !Array.isArray(data.players)) throw new Error('Kampaania statistikat ei õnnestunud laadida.')
  return data as WoodpeckerReport
}
export const campaignNumber = (value: number) => new Intl.NumberFormat('et-EE', { maximumFractionDigits: 0 }).format(value)
export const campaignMoney = (value: number) => new Intl.NumberFormat('et-EE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(value)
export function campaignDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : minutes ? `${minutes} min ${Math.round(seconds % 60)} s` : `${Math.round(seconds)} s`
}
export const campaignDate = (value: string, time = false) => new Intl.DateTimeFormat('et-EE', { timeZone: 'Europe/Tallinn', day: '2-digit', month: '2-digit', ...(time ? { hour: '2-digit', minute: '2-digit' } as const : {}) }).format(new Date(value))
export const campaignPercent = (value: number, total: number) => total > 0 ? `${new Intl.NumberFormat('et-EE', { maximumFractionDigits: 1 }).format(value / total * 100)}%` : '—'
export function campaignCsv(rows: (string | number | null)[][]) {
  // Neutralize spreadsheet formulas in customer-entered names and UTM labels.
  return '\uFEFF' + rows.map(row => row.map(value => {
    const text = String(value ?? '')
    return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`
  }).join(';')).join('\r\n')
}
export function downloadCampaignCsv(rows: (string | number | null)[][], filename: string) {
  const url = URL.createObjectURL(new Blob([campaignCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
