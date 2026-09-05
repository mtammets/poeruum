import { createRandomId } from '../lib/randomId'

export type CardSideId = 'front' | 'back'
export type CardElementType = 'text' | 'image' | 'shape' | 'qr'
export type CardElement = {
  id: string
  type: CardElementType
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  locked: boolean
  text?: string
  fontFamily?: 'sans' | 'serif' | 'mono'
  fontSize?: number
  fontWeight?: 400 | 700
  textAlign?: 'left' | 'center' | 'right'
  color?: string
  shape?: 'rectangle' | 'ellipse' | 'line'
  src?: string
  pixelWidth?: number
  pixelHeight?: number
  cropX?: number
  cropY?: number
  qrValue?: string
}
export type CardSide = { background: string; elements: CardElement[] }
export type CardDocument = {
  version: 1
  width: number
  height: number
  bleed: number
  cropMarks: boolean
  sides: Record<CardSideId, CardSide>
}

export const CARD_SIDE_LABELS: Record<CardSideId, string> = { front: 'Esikülg', back: 'Tagakülg' }
export const CARD_ELEMENT_LABELS: Record<CardElementType, string> = { text: 'Tekst', image: 'Pilt', shape: 'Kujund', qr: 'QR-kood' }
export const MM_PER_PT = 25.4 / 72
export const MAX_CARD_BYTES = 12_000_000
export const MAX_ELEMENTS = 60
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export const round = (value: number) => Math.round(value * 100) / 100

export function createCardElement(type: CardElementType, overrides: Partial<CardElement> = {}): CardElement {
  return {
    id: createRandomId(), type, name: CARD_ELEMENT_LABELS[type],
    x: 10, y: 12, width: type === 'text' ? 48 : 22, height: type === 'text' ? 12 : 22,
    rotation: 0, locked: false, color: '#244d3c',
    ...(type === 'text' ? { text: 'Sinu tekst', fontFamily: 'sans' as const, fontSize: 14, fontWeight: 400 as const, textAlign: 'left' as const } : {}),
    ...(type === 'shape' ? { shape: 'rectangle' as const } : {}),
    ...(type === 'qr' ? { qrValue: 'https://poeruum.ee', color: '#17231c' } : {}),
    ...overrides,
  }
}

export function createDefaultCard(): CardDocument {
  return {
    version: 1, width: 85, height: 55, bleed: 3, cropMarks: false,
    sides: {
      front: { background: '#244d3c', elements: [
        createCardElement('shape', { name: 'Aktsent', x: 7, y: 8, width: 9, height: 2, color: '#e4ef85' }),
        createCardElement('text', { name: 'Poeruum', text: 'Poeruum', x: 7, y: 18, width: 70, height: 14, fontSize: 28, fontWeight: 700, color: '#f8f5ec' }),
        createCardElement('text', { name: 'Veebiaadress', text: 'poeruum.ee', x: 7, y: 42, width: 60, height: 6, fontSize: 10, color: '#e4ef85' }),
      ] },
      back: { background: '#f8f5ec', elements: [
        createCardElement('text', { name: 'Pealkiri', text: 'Sinu pood.\nSinu moodi.', x: 7, y: 8, width: 52, height: 21, fontSize: 20, fontWeight: 700 }),
        createCardElement('text', { name: 'Kontakt', text: 'info@poeruum.ee\npoeruum.ee', x: 7, y: 36, width: 45, height: 12, fontSize: 9 }),
        createCardElement('qr', { x: 61, y: 30, width: 18, height: 18 }),
      ] },
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const numberIn = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)

// Validate persisted/imported documents before their values reach the canvas or PDF.
export function parseCardDocument(value: unknown): CardDocument {
  const invalid = () => { throw new Error('Visiitkaardi fail on vigane või seda versiooni ei toetata.') }
  if (!isRecord(value) || value.version !== 1 || !numberIn(value.width, 40, 150) || !numberIn(value.height, 30, 150)
    || !numberIn(value.bleed, 0, 5) || typeof value.cropMarks !== 'boolean' || !isRecord(value.sides)) return invalid()
  const ids = new Set<string>()
  for (const sideId of ['front', 'back']) {
    const side = value.sides[sideId]
    if (!isRecord(side) || !isColor(side.background) || !Array.isArray(side.elements) || side.elements.length > MAX_ELEMENTS) return invalid()
    for (const el of side.elements) {
      if (!isRecord(el) || typeof el.id !== 'string' || !el.id || el.id.length > 100 || ids.has(el.id)
        || !['text', 'image', 'shape', 'qr'].includes(String(el.type)) || typeof el.name !== 'string' || el.name.length > 120
        || !numberIn(el.x, -300, 300) || !numberIn(el.y, -300, 300) || !numberIn(el.width, 0.5, 300)
        || !numberIn(el.height, 0.5, 300) || !numberIn(el.rotation, -360, 360) || typeof el.locked !== 'boolean'
        || (el.color !== undefined && !isColor(el.color))) return invalid()
      ids.add(el.id)
      if (el.type === 'text' && (typeof el.text !== 'string' || el.text.length > 3000 || !numberIn(el.fontSize, 4, 120)
        || !['sans', 'serif', 'mono'].includes(String(el.fontFamily)) || (el.fontWeight !== 400 && el.fontWeight !== 700)
        || !['left', 'center', 'right'].includes(String(el.textAlign)))) return invalid()
      if (el.type === 'shape' && !['rectangle', 'ellipse', 'line'].includes(String(el.shape))) return invalid()
      if (el.type === 'qr' && (typeof el.qrValue !== 'string' || !el.qrValue.trim() || el.qrValue.length > 500)) return invalid()
      if (el.type === 'image' && (typeof el.src !== 'string' || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(el.src)
        || !numberIn(el.pixelWidth, 1, 20000) || !numberIn(el.pixelHeight, 1, 20000)
        || (el.cropX !== undefined && !numberIn(el.cropX, 0, 100)) || (el.cropY !== undefined && !numberIn(el.cropY, 0, 100)))) return invalid()
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_CARD_BYTES) throw new Error('Visiitkaardi fail on liiga suur (kuni 12 MB).')
  return structuredClone(value) as CardDocument
}

export function elementBounds(el: CardElement) {
  const angle = el.rotation * Math.PI / 180
  const halfWidth = (Math.abs(el.width * Math.cos(angle)) + Math.abs(el.height * Math.sin(angle))) / 2
  const halfHeight = (Math.abs(el.width * Math.sin(angle)) + Math.abs(el.height * Math.cos(angle))) / 2
  return { left: el.x + el.width / 2 - halfWidth, top: el.y + el.height / 2 - halfHeight, right: el.x + el.width / 2 + halfWidth, bottom: el.y + el.height / 2 + halfHeight }
}

export type CardIssue = { side: CardSideId; elementId: string; message: string; severity: 'warning' | 'error' }
export function getCardIssues(doc: CardDocument): CardIssue[] {
  const issues: CardIssue[] = []
  for (const side of ['front', 'back'] as const) {
    for (const el of doc.sides[side].elements) {
      const bounds = elementBounds(el)
      const issue = (message: string, severity: CardIssue['severity'] = 'warning') => issues.push({ side, elementId: el.id, message, severity })
      if (bounds.right <= 0 || bounds.left >= doc.width || bounds.bottom <= 0 || bounds.top >= doc.height) issue('Element jääb kaardist välja.', 'error')
      else if ((el.type === 'text' || el.type === 'qr') && (bounds.left < 3 || bounds.top < 3 || bounds.right > doc.width - 3 || bounds.bottom > doc.height - 3)) issue('Element on lõikeservale liiga lähedal.')
      if (el.type === 'text' && !el.text?.trim()) issue('Tekst on tühi.')
      if (el.type === 'image') {
        const ppi = Math.min((el.pixelWidth ?? 0) / el.width, (el.pixelHeight ?? 0) / el.height) * 25.4
        if (ppi < 300) issue(`Pildi kvaliteet on trükiks madal (${Math.round(ppi)} ppi).`)
      }
      if (el.type === 'qr' && Math.min(el.width, el.height) < 15) issue('QR-kood on trükiks liiga väike.')
    }
  }
  return issues
}
