import { describe, expect, it } from 'vitest'
import { createCampaign, validateCampaign } from './model'
import { sceneElements, transformOf } from './layout'
import { animateElement, phoneMotionAt, removePhoneMotion } from './motion'

describe('campaign phone motion', () => {
  it('zooms continuously across actions and holds the final pose through the outro', () => {
    const doc = createCampaign()
    const scales = [0, 1, 2.99, 3, 3.01, 6, 9].map((time) => phoneMotionAt(doc, 'reel', time).scale)
    expect(scales[0]).toBe(1)
    expect(scales.at(-1)).toBeCloseTo(1.06)
    expect(scales).toEqual([...scales].sort((a, b) => a - b))
    expect(scales[4] - scales[2]).toBeLessThan(.001)
    expect(phoneMotionAt(doc, 'reel', 12)).toEqual(phoneMotionAt(doc, 'reel', 9))
    const still = { ...doc, phoneMotion: 'still' as const }
    expect(phoneMotionAt(still, 'reel', 8)).toEqual({ scale: 1, rotation: 0 })
  })
  it('uses the selected video duration and preserves poster and brand-card geometry', () => {
    const doc = createCampaign()
    doc.phoneMotion = 'float'
    doc.phoneContent = { snapshot: { id: 's', capturedAt: '2026-10-05', store: { id: 's', name: 'Pood', slug: 'pood', settings: {} }, products: [], assets: {} }, actions: [{ type: 'product', productId: 'p', duration: 10 }, { type: 'scroll', productId: 'p', duration: 10 }] }
    expect(phoneMotionAt(doc, 'reel', 10)).toEqual({ scale: 1.03, rotation: 1.4 })
    expect(phoneMotionAt(doc, 'reel', 20).scale).toBeCloseTo(1.06)
    const post = sceneElements(doc, 'post0')[0]
    expect(animateElement(post, doc, 'post0', 10)).toEqual(post)
    for (const element of sceneElements(doc, 'reelEnd')) expect(animateElement(element, doc, 'reelEnd', 22)).toEqual(element)
  })
  it('keeps a moved or resized paused phone from accumulating zoom in its saved layout', () => {
    const doc = { ...createCampaign(), phoneMotion: 'float' as const }
    const base = sceneElements(doc, 'reel')[0], visible = animateElement(base, doc, 'reel', 4.5)
    const original = removePhoneMotion(transformOf(visible), doc, 'reel', 4.5)
    expect(original.scale).toBeCloseTo(base.scale)
    expect(original.rotation).toBeCloseTo(base.rotation)
    const resized = { ...transformOf(visible), x: visible.x + 30, scale: visible.scale * 1.1 }
    const saved = removePhoneMotion(resized, doc, 'reel', 4.5)
    expect(saved.scale).toBeCloseTo(base.scale * 1.1)
    expect(animateElement({ ...base, ...saved }, doc, 'reel', 4.5).x).toBe(resized.x)
    expect(animateElement({ ...base, ...saved }, doc, 'reel', 4.5).scale).toBeCloseTo(resized.scale)
    expect(validateCampaign(doc)?.phoneMotion).toBe('float')
    expect(validateCampaign({ ...doc, phoneMotion: 'unknown' })).toBeNull()
  })
})
