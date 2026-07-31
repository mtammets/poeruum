import { describe, expect, it } from 'vitest'
import {
  getAnalyticsDevice,
  getAnalyticsEngagementSeconds,
  getAnalyticsReferrerHost,
  isHomepageAnalyticsLocation,
  isAnalyticsEngagementActive,
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

  it('counts only whole active seconds and caps outlier sessions at 30 minutes', () => {
    expect(getAnalyticsEngagementSeconds(-1)).toBe(0)
    expect(getAnalyticsEngagementSeconds(9_999)).toBe(9)
    expect(getAnalyticsEngagementSeconds(75_500)).toBe(75)
    expect(getAnalyticsEngagementSeconds(31 * 60 * 1_000)).toBe(1_800)
  })

  it('counts engagement only while the page is visible and focused', () => {
    expect(isAnalyticsEngagementActive('visible', true)).toBe(true)
    expect(isAnalyticsEngagementActive('visible', false)).toBe(false)
    expect(isAnalyticsEngagementActive('hidden', true)).toBe(false)
  })
})
