import { describe, expect, it } from 'vitest'
import { createDirectorySession, isDirectoryAnalyticsLocation } from './directoryAnalyticsSession'
import { validateDirectoryEvents, type DirectoryEvent } from '../../supabase/functions/_shared/directory-analytics'

const store = '96000000-0000-4000-8000-000000000001'
const context = { referrer_host: 'google.com', utm_source: '', device_type: 'mobile' as const }
const page = { id: store, session_id: store, event_name: 'page_view', ...context }

describe('directory event boundary', () => {
  it('whitelists data, discards personal search text and client timestamps, and normalizes sources', () => {
    const events = validateDirectoryEvents({ events: [{ ...page, event_name: 'search', result_count: 0,
      query: 'private@example.com', occurred_at: '2001-01-01', store_name: 'Forged', user_id: store,
      referrer_host: 'https://host.test/private?email=x', utm_source: ' Newsletter! ' }] })
    expect(events).toEqual([{ ...page, event_name: 'search', result_count: 0, referrer_host: '', utm_source: 'newsletter' }])
  })
  it('rejects malformed events and excessive batches', () => {
    for (const event of [
      { ...page, session_id: 'bad' }, { ...page, event_name: 'other' }, { ...page, device_type: 'other' },
      { ...page, event_name: 'search', result_count: -1 }, { ...page, event_name: 'search', result_count: 0.1 },
      { ...page, store_id: store }, { ...page, event_name: 'store_click', store_id: store, position: 0, placement: 'directory' },
      { ...page, event_name: 'product_click', store_id: store, position: 1, placement: 'search' },
    ]) expect(validateDirectoryEvents({ events: [event] })).toBeNull()
    expect(validateDirectoryEvents({ events: [] })).toBeNull()
    expect(validateDirectoryEvents({ events: Array(21).fill(page) })).toBeNull()
    expect(validateDirectoryEvents({ events: [{ ...page, event_name: 'product_click', store_id: store, product_id: 'sku-1', position: 2, placement: 'search' }] })).toHaveLength(1)
  })
})

describe('directory visits', () => {
  function setup(initial = Date.parse('2026-09-20T12:00:00Z')) {
    let now = initial
    let serial = 0
    const emitted: DirectoryEvent[] = []
    const options = {
      now: () => now, uuid: () => `10000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
      context: () => context, emit: (event: DirectoryEvent) => emitted.push(event),
    }
    return { options, emitted, setTime: (time: number) => { now = time }, start: () => createDirectorySession(options) }
  }
  it('deduplicates double clicks while recording keyboard clicks as seen cards', () => {
    const s = setup()
    const track = s.start()
    const click = { event_name: 'store_click' as const, store_id: store, placement: 'directory' as const, position: 3 }
    track(click); track(click)
    expect(s.emitted.map((event) => event.event_name)).toEqual(['page_view', 'store_impression', 'store_click'])
    track({ ...click, placement: 'search' })
    expect(s.emitted).toHaveLength(5)
    expect(s.emitted[3].position).toBe(3)
  })
  it('starts new visits after inactivity and at Tallinn midnight', () => {
    const s = setup(Date.parse('2026-09-20T20:50:00Z'))
    const track = s.start()
    track({ event_name: 'page_view' })
    s.setTime(Date.parse('2026-09-20T21:01:00Z'))
    track({ event_name: 'search', result_count: 0 })
    s.setTime(Date.parse('2026-09-20T21:32:00Z'))
    track({ event_name: 'search', result_count: 1 })
    expect(new Set(s.emitted.map((event) => event.session_id)).size).toBe(3)
    expect(s.emitted.filter((event) => event.event_name === 'page_view')).toHaveLength(3)
  })
  it('keeps visits in memory only, so opening a new page starts a new visit', () => {
    const s = setup()
    const track = s.start()
    track({ event_name: 'page_view' }); track({ event_name: 'page_view' })
    expect(s.emitted).toHaveLength(1)
    s.start()({ event_name: 'page_view' })
    expect(s.emitted).toHaveLength(2)
    expect(s.emitted[0].session_id).not.toBe(s.emitted[1].session_id)
  })
  it('never sends local or story visits to production analytics', () => {
    const production = 'https://project.supabase.co/functions/v1/directory-analytics'
    expect(isDirectoryAnalyticsLocation('kaubamaja.poeruum.ee', '/', production)).toBe(true)
    expect(isDirectoryAnalyticsLocation('kaubamaja.poeruum.ee', '/lood/test', production)).toBe(false)
    expect(isDirectoryAnalyticsLocation('kaubamaja.poeruum.localhost', '/', production)).toBe(false)
    expect(isDirectoryAnalyticsLocation('localhost', '/', production)).toBe(false)
    expect(isDirectoryAnalyticsLocation('kaubamaja.poeruum.localhost', '/', 'http://localhost:4174/mock')).toBe(true)
  })
})
