import type { CampaignDocument } from './model'
import type { LayerTransform, SceneElement, SceneKey } from './layout'
import { contentDuration } from './phoneContent'

export const phoneMotions = [
  { id: 'still', name: 'Paigal' },
  { id: 'zoom', name: 'Õrn suum' },
  { id: 'float', name: 'Suum ja kallutus' },
] as const
export type PhoneMotion = typeof phoneMotions[number]['id']

// Timeline time drives both preview and export. Never restart the movement at an
// action boundary: scrolling, typing and gallery changes remain easy to follow.
export function phoneMotionAt(doc: CampaignDocument, scene: SceneKey, time: number) {
  const mode = doc.phoneMotion ?? 'zoom'
  if (scene !== 'reel' || mode === 'still') return { scale: 1, rotation: 0 }
  const progress = Math.max(0, Math.min(1, time / contentDuration(doc)))
  const eased = progress * progress * (3 - 2 * progress)
  return { scale: 1 + .06 * eased, rotation: mode === 'float' ? 1.4 * Math.sin(Math.PI * eased) : 0 }
}

export function animateElement(element: SceneElement, doc: CampaignDocument, scene: SceneKey, time: number): SceneElement {
  if (element.id !== 'phone') return element
  const motion = phoneMotionAt(doc, scene, time)
  return { ...element, scale: element.scale * motion.scale, rotation: element.rotation + motion.rotation }
}

// Handles follow the visible frame; persist the underlying layout so dragging
// or resizing a paused video never bakes its current zoom into every frame.
export function removePhoneMotion(transform: LayerTransform, doc: CampaignDocument, scene: SceneKey, time: number): LayerTransform {
  const motion = phoneMotionAt(doc, scene, time)
  return { ...transform, scale: Math.max(.15, Math.min(3, transform.scale / motion.scale)), rotation: Math.max(-180, Math.min(180, transform.rotation - motion.rotation)) }
}
