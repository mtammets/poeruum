import { describe, expect, it, vi } from 'vitest'
import { campaignCheckoutContext, campaignSurfaceForHost, validateCampaignEvents, WOODPECKER_START, type CampaignEvent } from '../../supabase/functions/_shared/woodpecker-analytics'
import { campaignCsv, campaignDuration, campaignPercent } from './woodpeckerAnalytics'
import { canTrackWoodpecker } from './woodpeckerTracking'

vi.mock('./supabase', () => ({ supabase: null, requireSupabase: vi.fn() }))

const id = '10000000-0000-4000-8000-000000000001'
const event: CampaignEvent = { id, visitor_id: id, session_id: id, surface: 'directory', event_name: 'visit', source: 'Google',
  device: 'desktop', utm_campaign: 'musta-rahni', product_id: '', placement: '', game_id: null, value: 0, duration: 0 }
describe('woodpecker measurement boundaries', () => {
  it('starts at 06:00 Estonia on 4 November, independent of the device timezone', () => {
    expect(new Date(WOODPECKER_START).toISOString()).toBe('2026-11-04T04:00:00.000Z')
  })
  it('accepts only the three campaign origins', () => {
    expect(campaignSurfaceForHost('kruk-kruk.ee')).toBe('homepage')
    expect(campaignSurfaceForHost('www.kruk-kruk.ee')).toBe('homepage')
    expect(campaignSurfaceForHost('kruk-kruk.poeruum.ee')).toBe('store')
    expect(campaignSurfaceForHost('kruk-kruk.ee.evil.test')).toBeNull()
    expect(campaignSurfaceForHost('other.poeruum.ee')).toBeNull()
  })
  it('excludes local, preview, merchant and wrong-surface visits from production', () => {
    const location = { hostname: 'kaubamaja.poeruum.ee', pathname: '/', search: '' }
    const endpoint = 'https://project.supabase.co/functions/v1/woodpecker-analytics'
    expect(canTrackWoodpecker(location, 'directory', endpoint)).toBe(true)
    for (const patch of [{ hostname: 'localhost' }, { pathname: '/admin' }, { search: '?theme=black-friday' }, { search: '?preview=1' }]) {
      expect(canTrackWoodpecker({ ...location, ...patch }, 'directory', endpoint)).toBe(false)
    }
    expect(canTrackWoodpecker(location, 'homepage', endpoint)).toBe(false)
    expect(canTrackWoodpecker({ ...location, hostname: 'kaubamaja.poeruum.localhost' }, 'directory', 'http://localhost:4174/functions')).toBe(true)
    expect(canTrackWoodpecker({ ...location, hostname: 'kaubamaja.poeruum.localhost' }, 'directory', endpoint)).toBe(false)
  })
  it('projects known fields and never accepts caller-provided names or payment events', () => {
    const result = validateCampaignEvents({ events: [{ ...event, customer_name: 'Private', user_id: id }] })
    expect(result).toEqual([event])
    expect(validateCampaignEvents({ events: [{ ...event, event_name: 'purchase' }] })).toBeNull()
    expect(validateCampaignEvents({ events: [{ ...event, utm_campaign: 'person@example.com' }] })).toBeNull()
  })
  it('rejects malformed, oversized and impossible game batches', () => {
    for (const events of [[], Array(21).fill(event), [{ ...event, visitor_id: 'invalid' }], [{ ...event, value: -1 }],
      [{ ...event, event_name: 'game_start' }], [{ ...event, event_name: 'game_progress', game_id: id, surface: 'store' }],
      [{ ...event, event_name: 'game_end', game_id: id, duration: 86401 }], [{ ...event, event_name: 'scroll', value: 101 }]]) {
      expect(validateCampaignEvents({ events })).toBeNull()
    }
    expect(validateCampaignEvents({ events: [{ ...event, event_name: 'game_end', game_id: id, value: 15, duration: 85 }] })).not.toBeNull()
  })
  it('checkout attribution accepts only anonymous UUIDs and discards everything else', () => {
    expect(campaignCheckoutContext({ visitor_id: id, session_id: id, name: 'Ignored' })).toEqual({ visitor_id: id, session_id: id })
    expect(campaignCheckoutContext({ visitor_id: 'fake', session_id: id })).toBeNull()
    expect(campaignCheckoutContext(null)).toBeNull()
  })
  it('exports safe spreadsheet cells and never renders an undefined conversion rate', () => {
    expect(campaignCsv([['=HYPERLINK("bad")', '@formula', 'Normal;name', null]])).toBe('\uFEFF"\'=HYPERLINK(""bad"")";"\'@formula";"Normal;name";""')
    expect(campaignPercent(0, 0)).toBe('—')
    expect(campaignDuration(125)).toBe('2 min 5 s')
  })
})
