import type { AdminUserRow } from './adminUserOverview'

export type WatchScene = 'analytics' | 'users' | 'income'
export type WatchEvent = {
  id: string
  kind: 'visit' | 'account' | 'published' | 'income'
  at: number
  title: string
  detail: string
  count?: number
  amount?: number
  userId?: string
  revenueIds?: string[]
}

export const watchPriority = (event: WatchEvent) => ({ visit: 1, published: 2, account: 3, income: 4 })[event.kind]
export const watchScene = (event: WatchEvent): WatchScene => event.kind === 'visit' ? 'analytics' : event.kind === 'income' ? 'income' : 'users'
export const watchDay = (time: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time)

// A successful initial snapshot is a baseline, never an arrival. Account dates
// prevent restored/old rows from looking like new signups after a reconnect.
export function userWatchEvents(previous: AdminUserRow[], rows: AdminUserRow[], since: number, now: number): WatchEvent[] {
  const before = new Map(previous.map((row) => [row.user_id, row]))
  return rows.flatMap((row) => {
    const old = before.get(row.user_id)
    const created = Date.parse(row.user_created_at)
    const detail = row.store_name || row.email
    if (!old && created >= since && created <= now + 5000) return [{ id: `account:${row.user_id}`, kind: 'account', at: now, title: 'Uus kasutaja', detail, userId: row.user_id } as WatchEvent]
    if (old && !old.is_published && row.is_published && row.store_id) return [{ id: `published:${row.store_id}`, kind: 'published', at: now, title: 'Pood on avalik', detail, userId: row.user_id } as WatchEvent]
    return []
  })
}

export function queueWatchEvents(queue: WatchEvent[], incoming: WatchEvent[], now: number): WatchEvent[] {
  const result = queue.filter((event) => now - event.at < 60_000).map((event) => ({ ...event }))
  for (const event of incoming) {
    if (result.some((item) => item.id === event.id)) continue
    const visits = event.kind === 'visit' ? result.find((item) => item.kind === 'visit') : undefined
    if (visits) { visits.count = (visits.count ?? 0) + (event.count ?? 0); visits.at = event.at }
    else result.push({ ...event })
  }
  return result.sort((a, b) => watchPriority(b) - watchPriority(a) || a.at - b.at).slice(0, 12)
}
