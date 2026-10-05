import { describe, expect, it } from 'vitest'
import { actionTimeline, campaignDuration, materializeSnapshot, parsePhoneContent, presetActions, productMedia, mediaSource, type PhoneContent } from './phoneContent'
import { createCampaign, validateCampaign, campaignText } from './model'
const fixture = (): PhoneContent => ({
  snapshot: { id: 'snapshot-1', capturedAt: '2026-10-05T09:00:00Z', store: { id: 'store-1', name: 'Päris pood', slug: 'paris-pood', settings: { storeTheme: 'paper', storeLogo: 'asset:0' } },
    assets: { 'asset:0': 'data:image/jpeg;base64,YWJj', 'asset:1': 'data:image/jpeg;base64,ZGVm' },
    products: [{ id: 'p1', name: 'Sinine kruus', alt: 'Kruus', image: 'asset:0', gallery: ['asset:0', 'asset:1'], price: 19, description: 'Käsitsi tehtud' }, { id: 'p2', name: 'Kauss', alt: 'Kauss', image: 'asset:1', gallery: ['asset:1'], price: 25 }] },
  actions: [{ type: 'product', productId: 'p1', duration: 2 }, { type: 'scroll', productId: 'p1', duration: 3 }, { type: 'search', productId: 'p2', query: 'kauss', duration: 5 }],
})
describe('campaign store snapshots and action timelines', () => {
  it('preserves independent snapshots and computes the same durations used in exports and text', () => {
    const content = fixture(), doc = { ...createCampaign(), phoneContent: content, media: productMedia(content.snapshot) }
    expect(validateCampaign(doc)).not.toBeNull()
    expect(campaignDuration(doc)).toBe(13)
    expect(actionTimeline(content.actions).map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 5], [5, 10]])
    expect(campaignText(doc)).toContain('10–13 s: Poeruum.')
    expect(campaignText(doc)).toContain('5–10 s: Otsi toodet · Kauss · kauss')
    const restored = materializeSnapshot(content.snapshot)
    expect(restored.products[0].gallery).toEqual(Object.values(content.snapshot.assets))
    expect(restored.store.settings.storeLogo).toBe(content.snapshot.assets['asset:0'])
    expect(mediaSource(doc, doc.media[1].src)).toBe(content.snapshot.assets['asset:1'])
    expect(campaignDuration(createCampaign())).toBe(12)
  })
  it('rejects stale product references, absent gallery frames, invalid durations and searches without a result', () => {
    for (const action of [
      { type: 'product', productId: 'missing', duration: 2 },
      { type: 'gallery', productId: 'p2', imageIndex: 1, duration: 2 },
      { type: 'scroll', productId: 'p1', duration: NaN },
      { type: 'product', productId: 'p1', duration: 0 },
      { type: 'search', productId: 'p2', query: 'kruus', duration: 3 },
    ]) expect(parsePhoneContent({ ...fixture(), actions: [action] })).toBeNull()
    expect(parsePhoneContent({ ...fixture(), actions: Array.from({ length: 3 }, () => ({ type: 'product', productId: 'p1', duration: 10 })) })).toBeNull()
  })
  it('allows only embedded raster images and keeps private store settings out of restored snapshots', () => {
    const content = fixture(); content.snapshot.store.settings.privateKey = 'do-not-keep'
    expect(parsePhoneContent(content)?.snapshot.store.settings).not.toHaveProperty('privateKey')
    content.snapshot.assets['asset:0'] = 'https://example.com/mutable.jpg'
    expect(parsePhoneContent(content)).toBeNull()
    content.snapshot.assets['asset:0'] = 'data:image/svg+xml;base64,YWJj'
    expect(parsePhoneContent(content)).toBeNull()
    content.snapshot.assets['asset:0'] = 'data:image/jpeg;base64,YWJj'
    content.snapshot.products[0].image = 'asset:9'
    expect(parsePhoneContent(content)).toBeNull()
  })
  it('restores unfinished draft actions without accepting them for export', () => {
    const content = fixture(); content.actions[2].query = ''
    const doc = { ...createCampaign(), phoneContent: content, media: productMedia(content.snapshot) }
    expect(validateCampaign(doc)).toBeNull()
    expect(validateCampaign(doc, true)?.phoneContent?.actions[2].query).toBe('')
    content.actions = Array.from({ length: 4 }, () => ({ type: 'product', productId: 'p1', duration: 10 }))
    expect(validateCampaign(doc)).toBeNull()
    expect(validateCampaign(doc, true)?.phoneContent?.actions).toHaveLength(4)
  })
  it('presets adapt to one product and unavailable galleries', () => {
    for (const preset of ['browse', 'products', 'search']) {
      const content = fixture(); content.snapshot.products = content.snapshot.products.slice(1)
      content.actions = presetActions(content.snapshot.products, preset)
      expect(parsePhoneContent(content)).not.toBeNull()
      expect(content.actions.reduce((sum, a) => sum + a.duration, 0)).toBe(9)
    }
  })
})
