import { describe, expect, it, vi } from 'vitest'
import { validateStoreAnalytics } from '../../supabase/functions/_shared/store-analytics'
import { createStoreAnalyticsSession, isStoreAnalyticsLocation, storeTrafficSource } from './storeAnalyticsSession'
import { storeAnalyticsTrend } from './storeAnalytics'

vi.mock('./supabase', () => ({ requireSupabase: vi.fn() }))

describe('store analytics privacy and session boundaries', () => {
  it('deduplicates products and starts a new visit on inactivity and Tallinn midnight', () => {
    let now = Date.parse('2026-10-07T12:00:00Z')
    let id = 0
    const events: { event_name: string; product_id: string; session_id: string }[] = []
    const track = createStoreAnalyticsSession({ now: () => now, uuid: () => `${++id}`, source: 'Google', emit: (event) => events.push(event) })
    track('a'); track('a'); track('b')
    expect(events.map((event) => event.event_name)).toEqual(['visit', 'product_view', 'product_view'])
    now += 30 * 60 * 1000
    track('a')
    expect(events.filter((event) => event.event_name === 'visit')).toHaveLength(2)
    expect(events[3].session_id).not.toBe(events[0].session_id)
    now = Date.parse('2026-10-07T20:59:59Z'); track('a')
    const beforeMidnight = events.length
    now += 2000; track('a')
    expect(events).toHaveLength(beforeMidnight + 2)
  })

  it('stores only source categories, never sensitive paths or campaign strings', () => {
    expect(storeTrafficSource('https://www.google.ee/search?q=private@email.test', 'shop.ee', null)).toBe('Google')
    expect(storeTrafficSource('https://l.instagram.com/?secret=value', 'shop.ee', null)).toBe('Instagram')
    expect(storeTrafficSource('https://shop.ee/toode/private', 'shop.ee', null)).toBe('Otse / teadmata')
    expect(storeTrafficSource('', 'shop.ee', 'kaubamaja')).toBe('Kaubamaja')
    expect(storeTrafficSource('', 'shop.ee', 'private@email.test')).toBe('Otse / teadmata')
    expect(storeTrafficSource('https://facebook.com.attacker.test/', 'shop.ee', null)).toBe('Muud viitajad')
  })

  it('validates public payloads and strips arbitrary data', () => {
    const event = { id: '10000000-0000-4000-8000-000000000001', session_id: '10000000-0000-4000-8000-000000000002', event_name: 'visit', product_id: '', source: 'Google' }
    const payload = { store_id: event.id, events: [{ ...event, email: 'secret@example.test', occurred_at: '2001-01-01' }] }
    expect(validateStoreAnalytics(payload)?.events).toEqual([event])
    expect(validateStoreAnalytics({ ...payload, events: [{ ...event, source: 'secret@example.test' }] })).toBeNull()
    expect(validateStoreAnalytics({ ...payload, events: [{ ...event, event_name: 'product_view' }] })).toBeNull()
    expect(validateStoreAnalytics({ ...payload, events: Array(21).fill(event) })).toBeNull()
    expect(validateStoreAnalytics({ ...payload, store_id: 'invalid' })).toBeNull()
  })

  it('never sends local, management or checkout previews to production', () => {
    const endpoint = 'https://example.supabase.co/functions/v1/store-analytics'
    expect(isStoreAnalyticsLocation({ hostname: 'localhost', pathname: '/', search: '' }, endpoint)).toBe(false)
    expect(isStoreAnalyticsLocation({ hostname: 'shop.poeruum.ee', pathname: '/haldus', search: '' }, endpoint)).toBe(false)
    expect(isStoreAnalyticsLocation({ hostname: 'shop.ee', pathname: '/', search: '?checkout=success' }, endpoint)).toBe(false)
    expect(isStoreAnalyticsLocation({ hostname: 'shop.ee', pathname: '/toode/kruus/', search: '?from=kaubamaja' }, endpoint)).toBe(true)
  })

  it('does not invent growth without history or exaggerate a small baseline', () => {
    expect(storeAnalyticsTrend(200, 0, false)).toBeNull()
    expect(storeAnalyticsTrend(3, 1, true)).toMatchObject({ label: '1 → 3', direction: 'up' })
    expect(storeAnalyticsTrend(100, 200, true)).toMatchObject({ label: '−50%', direction: 'down' })
  })
})
