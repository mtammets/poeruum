import { describe, expect, it } from 'vitest'
import { queueWatchEvents, userWatchEvents, watchDay, type WatchEvent } from './adminWatch'
import type { AdminUserRow } from './adminUserOverview'

const now = Date.parse('2026-10-08T12:00:00Z')
const row = (id: string, published = false, created = now) => ({ user_id: id, user_created_at: new Date(created).toISOString(), email: `${id}@example.invalid`, store_id: id, store_name: id, is_published: published } as AdminUserRow)
const event = (id: string, kind: WatchEvent['kind'], at = now): WatchEvent => ({ id, kind, at, title: id, detail: '', count: kind === 'visit' ? 1 : undefined })

describe('watch events', () => {
  it('announces recent new accounts and publication changes once per snapshot', () => {
    const before = [row('one')]
    const after = [row('one', true), row('two')]
    expect(userWatchEvents(before, after, now - 1000, now).map((item) => item.kind)).toEqual(['published', 'account'])
    expect(userWatchEvents(after, after, now, now + 1000)).toEqual([])
  })
  it('does not present restored historical or implausibly future accounts as arrivals', () => {
    expect(userWatchEvents([], [row('old', false, now - 10_000), row('future', false, now + 60_000)], now, now)).toEqual([])
  })
  it('groups visitor bursts, deduplicates, expires events and prioritizes income', () => {
    const queued = queueWatchEvents([event('old', 'income', now - 60_001), event('v1', 'visit')], [event('v2', 'visit'), event('a', 'account'), event('a', 'account'), event('p', 'published'), event('r', 'income')], now)
    expect(queued.map((item) => item.kind)).toEqual(['income', 'account', 'published', 'visit'])
    expect(queued.at(-1)?.count).toBe(2)
    expect(queueWatchEvents(queued, [], now + 60_001)).toEqual([])
  })
  it('bounds busy queues and uses the Estonian date around midnight', () => {
    expect(queueWatchEvents([], Array.from({ length: 100 }, (_, i) => event(String(i), 'account')), now)).toHaveLength(12)
    expect(watchDay(Date.parse('2026-10-08T21:30:00Z'))).toBe('2026-10-09')
  })
})
