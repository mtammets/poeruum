import { describe, expect, it } from 'vitest'
import {
  getAnalyticsDevice,
  getAnalyticsReferrerHost,
  isHomepageAnalyticsLocation,
  sanitizeAnalyticsCampaignValue,
} from './homepageAnalytics'

describe('homepage analytics privacy helpers', () => {
  it('enables collection only on the production marketing homepage', () => {
    expect(isHomepageAnalyticsLocation({ hostname: 'poeruum.ee', pathname: '/', search: '?utm_source=facebook' })).toBe(true)
    expect(isHomepageAnalyticsLocation({ hostname: 'www.poeruum.ee', pathname: '/', search: '' })).toBe(true)
    expect(isHomepageAnalyticsLocation({ hostname: 'poeruum.ee', pathname: '/admin', search: '' })).toBe(false)
    expect(isHomepageAnalyticsLocation({ hostname: 'localhost', pathname: '/', search: '' })).toBe(false)
    expect(isHomepageAnalyticsLocation({ hostname: 'poeruum.ee', pathname: '/', search: '?billing=success' })).toBe(false)
  })

  it('keeps only the external referrer hostname', () => {
    expect(getAnalyticsReferrerHost('https://www.facebook.com/private/path?email=user@example.com', 'poeruum.ee'))
      .toBe('www.facebook.com')
    expect(getAnalyticsReferrerHost('https://poeruum.ee/privaatsus?token=secret', 'poeruum.ee')).toBe('')
    expect(getAnalyticsReferrerHost('not-a-url', 'poeruum.ee')).toBe('')
  })

  it('removes unsafe campaign characters and caps stored text', () => {
    expect(sanitizeAnalyticsCampaignValue('  Suvi<script>@2026  ', 20)).toBe('suviscript2026')
    expect(sanitizeAnalyticsCampaignValue('x'.repeat(120), 80)).toHaveLength(80)
  })

  it('derives a coarse device category without storing a user agent', () => {
    expect(getAnalyticsDevice(390)).toBe('mobile')
    expect(getAnalyticsDevice(900)).toBe('tablet')
    expect(getAnalyticsDevice(1440)).toBe('desktop')
  })
})
