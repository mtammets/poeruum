import type { CampaignDocument } from './model'

export type CampaignFormat = 'reel' | 'story' | 'post'
export const sceneKeys = ['reel', 'reelEnd', 'post0', 'post1', 'post2', 'story0', 'story1', 'story2'] as const
export type SceneKey = typeof sceneKeys[number]
export const layerIds = ['phone', 'photo1', 'photo2', 'photo3', 'logo', 'headline', 'slogan', 'support', 'cta', 'url'] as const
export type LayerId = typeof layerIds[number]
export type LayerTransform = { x: number; y: number; scale: number; rotation: number; visible: boolean }
export type CampaignLayouts = Partial<Record<SceneKey, Partial<Record<LayerId, LayerTransform>>>>
export type SceneElement = LayerTransform & { id: LayerId; name: string; width: number; height: number; text?: string; size?: number; maxLines?: number; imageIndex?: number }
export const SAFE_ZONE_SOURCE = 'https://www.facebook.com/business/help/980593475366490'

export const sceneKey = (format: CampaignFormat, index = 0, end = false): SceneKey => format === 'reel' ? end ? 'reelEnd' : 'reel' : `${format}${index}` as SceneKey
export const sceneHeight = (scene: SceneKey) => scene.startsWith('post') ? 1350 : 1920

// Conservative guides for 9:16 ads. Backgrounds and decorative edges may bleed;
// keep campaign copy/logo/CTA inside. Actual placement UI can vary. Reels' bottom
// 35% is documented in Meta's Reels creative guide; use the same cautious margin
// for Stories so a campaign can also be advertised across placements.
export function safeArea(scene: SceneKey) {
  const height = sceneHeight(scene)
  return scene.startsWith('post')
    ? { x: 54, y: 54, width: 972, height: height - 108 }
    : { x: 65, y: 269, width: 950, height: 979 }
}

export function sceneElements(doc: CampaignDocument, scene: SceneKey): SceneElement[] {
  const post = scene.startsWith('post'), end = scene === 'reelEnd', reel = scene === 'reel'
  const index = Number(scene.slice(-1)) || 0
  const elements: SceneElement[] = []
  const add = (id: LayerId, name: string, width: number, height: number, x: number, y: number, options: Partial<SceneElement> = {}) => {
    elements.push({ id, name, width, height, x, y, scale: 1, rotation: 0, visible: true, ...options, ...doc.layouts?.[scene]?.[id] })
  }
  if (end) {
    add('logo', 'Logo', 390, 90, 540, 440)
    add('headline', 'Pealkiri', 880, 135, 540, 650, { text: doc.endCopy?.headline ?? 'Sinu e-pood.', size: 112, maxLines: 1 })
    add('slogan', 'Slogan', 880, 135, 540, 800, { text: doc.endCopy?.slogan ?? '10 minutiga.', size: 109, maxLines: 1 })
    add('cta', 'Üleskutse', 460, 110, 540, 1010, { text: doc.copy.cta, size: 33 })
    add('url', 'Veebiaadress', 700, 55, 540, 1160, { text: 'poeruum.ee', size: 30 })
    return elements
  }
  if (doc.template === 'phone') {
    const standard = doc.textAmount === 'standard'
    add('phone', 'Telefon', 505, 999.9, 540, reel ? 915 : post ? standard ? 850 : 780 : standard ? 1110 : 1080,
      { scale: reel ? 1.3 : post ? standard ? .7 : .82 : standard ? .9 : 1.02, rotation: 3 })
  } else if (doc.template === 'products') {
    const center = post ? 800 : 930
    add('photo1', 'Pilt 1', 304, 404, 265, center - 90, { rotation: -8, imageIndex: (index + 1) % 3 })
    add('photo2', 'Pilt 2', 314, 419, 795, center + 110, { rotation: 7, imageIndex: (index + 2) % 3 })
    add('photo3', 'Pilt 3', 419, 569, 530, center, { rotation: -2, imageIndex: index })
  }
  const message = doc.template === 'message'
  add('logo', 'Logo', 312, 72, 540, post ? 115 : 330, { visible: !reel || message })
  add('headline', 'Pealkiri', 880, message ? 360 : 180, 540, message ? post ? 530 : 720 : post ? 280 : 475,
    { text: doc.copy.headlines[index], size: message ? 112 : 66, maxLines: message ? 3 : 2, visible: !reel || message })
  add('support', 'Lisatekst', 820, 90, 540, message ? post ? 830 : 995 : post ? 400 : 605,
    { text: doc.copy.support, size: 29, maxLines: 2, visible: doc.textAmount === 'standard' && (!reel || message) })
  add('cta', 'Üleskutse', 460, 100, 540, post ? 1120 : 1150, { text: doc.copy.cta, size: 30, visible: message })
  add('url', 'Veebiaadress', 900, 55, 540, post ? 1245 : 1200, { text: `poeruum.ee${doc.copy.cta ? `  ·  ${doc.copy.cta}` : ''}`, size: 26, visible: !reel && message })
  return elements
}

export function transformOf(element: LayerTransform): LayerTransform {
  const { x, y, scale, rotation, visible } = element
  return { x, y, scale, rotation, visible }
}
export function setElement(doc: CampaignDocument, scene: SceneKey, id: LayerId, transform: LayerTransform): CampaignDocument {
  return { ...doc, layouts: { ...doc.layouts, [scene]: { ...doc.layouts?.[scene], [id]: transform } } }
}
export function elementBounds(element: SceneElement) {
  const angle = element.rotation * Math.PI / 180
  const width = (Math.abs(Math.cos(angle)) * element.width + Math.abs(Math.sin(angle)) * element.height) * element.scale
  const height = (Math.abs(Math.sin(angle)) * element.width + Math.abs(Math.cos(angle)) * element.height) * element.scale
  return { x: element.x - width / 2, y: element.y - height / 2, width, height }
}
export function outsideSafeArea(element: SceneElement, scene: SceneKey) {
  const bounds = elementBounds(element), safe = safeArea(scene)
  return bounds.x < safe.x - 1 || bounds.y < safe.y - 1 || bounds.x + bounds.width > safe.x + safe.width + 1 || bounds.y + bounds.height > safe.y + safe.height + 1
}
export function fitToSafeArea(element: SceneElement, scene: SceneKey): LayerTransform {
  const safe = safeArea(scene), bounds = elementBounds(element)
  const scale = element.scale * Math.min(1, safe.width / bounds.width, safe.height / bounds.height)
  const next = { ...element, scale }, box = elementBounds(next)
  return { ...transformOf(next), x: Math.max(safe.x + box.width / 2, Math.min(safe.x + safe.width - box.width / 2, next.x)), y: Math.max(safe.y + box.height / 2, Math.min(safe.y + safe.height - box.height / 2, next.y)) }
}
export function parseLayouts(value: unknown): CampaignLayouts | null {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result: CampaignLayouts = {}
  for (const [scene, layers] of Object.entries(value)) {
    if (!sceneKeys.includes(scene as SceneKey) || !layers || typeof layers !== 'object' || Array.isArray(layers)) return null
    result[scene as SceneKey] = {}
    for (const [id, raw] of Object.entries(layers)) {
      const t = raw as LayerTransform
      if (!layerIds.includes(id as LayerId) || !t || typeof t !== 'object'
        || ![t.x, t.y, t.scale, t.rotation].every((n) => typeof n === 'number' && Number.isFinite(n))
        || Math.abs(t.x) > 2160 || Math.abs(t.y) > 3840 || t.scale < .15 || t.scale > 3 || Math.abs(t.rotation) > 180 || typeof t.visible !== 'boolean') return null
      result[scene as SceneKey]![id as LayerId] = transformOf(t)
    }
  }
  return result
}
