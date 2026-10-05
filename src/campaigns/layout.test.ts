import { describe, expect, it } from 'vitest'
import { createCampaign, validateCampaign } from './model'
import { elementBounds, fitToSafeArea, outsideSafeArea, parseLayouts, safeArea, sceneElements, setElement, transformOf } from './layout'
import { parseCampaignCopy } from '../../supabase/functions/_shared/campaign-schema'

describe('editable campaign layouts', () => {
  it('opens existing campaigns with a larger phone and branding only at the end', () => {
    const doc = createCampaign(), main = sceneElements(doc, 'reel')
    expect(main.filter((element) => element.visible).map((element) => element.id)).toEqual(['phone'])
    const phone = main.find((element) => element.id === 'phone')!
    expect(phone.width * phone.scale).toBeGreaterThan(650)
    for (const element of sceneElements(doc, 'reelEnd')) expect(outsideSafeArea(element, 'reelEnd')).toBe(false)
    expect(validateCampaign(doc)).toEqual(doc)
  })
  it('saves independent scenes and fits rotated objects fully inside the safe area', () => {
    const doc = createCampaign(), element = sceneElements(doc, 'reel')[0]
    const edited = { ...element, x: 980, y: 1800, scale: 2, rotation: 35 }
    const fitted = fitToSafeArea(edited, 'reel'), bounds = elementBounds({ ...edited, ...fitted }), safe = safeArea('reel')
    expect(bounds.width).toBeLessThanOrEqual(safe.width + .001)
    expect(bounds.height).toBeLessThanOrEqual(safe.height + .001)
    expect(outsideSafeArea({ ...edited, ...fitted }, 'reel')).toBe(false)
    const next = setElement(doc, 'reel', 'phone', transformOf(edited))
    expect(validateCampaign(next)).toEqual(next)
    expect(sceneElements(next, 'reelEnd')).toEqual(sceneElements(doc, 'reelEnd'))
    expect(sceneElements(next, 'story0')).toEqual(sceneElements(doc, 'story0'))
    expect(sceneElements(next, 'post1')).toEqual(sceneElements(doc, 'post1'))
  })
  it('retains intentionally empty authored text while AI responses stay strict', () => {
    const doc = createCampaign()
    doc.copy.headlines[0] = ''; doc.copy.cta = ''; doc.copy.captionShort = ''
    doc.endCopy = { headline: '', slogan: 'Minu uus slogan' }
    expect(validateCampaign(doc)).toEqual(doc)
    expect(parseCampaignCopy(doc.copy)).toBeNull()
  })
  it('rejects malformed layouts, unbounded coordinates and non-finite transforms', () => {
    const element = transformOf(sceneElements(createCampaign(), 'reel')[0])
    for (const patch of [{ x: Infinity }, { scale: NaN }, { y: 100000 }, { rotation: 999 }, { visible: 'yes' }, { scale: 0 }]) {
      expect(parseLayouts({ reel: { phone: { ...element, ...patch } } })).toBeNull()
    }
    expect(parseLayouts({ unknown: {} })).toBeNull()
    expect(parseLayouts({ reel: { unknown: element } })).toBeNull()
    expect(validateCampaign({ ...createCampaign(), endCopy: { headline: 'x', slogan: 5 } })).toBeNull()
  })
})
