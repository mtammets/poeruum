import { describe, expect, it } from 'vitest'
import {
  createCardElement, createDefaultCard, elementBounds, getCardIssues, MAX_CARD_BYTES, MAX_ELEMENTS,
  parseCardDocument, type CardDocument, type CardElement,
} from './model'

function cardWith(...elements: CardElement[]): CardDocument {
  const card = createDefaultCard()
  card.sides.front.elements = elements
  card.sides.back.elements = []
  return card
}

describe('parseCardDocument', () => {
  it('round-trips both editable sides without retaining mutable input references', () => {
    const original = createDefaultCard()
    original.sides.back.elements.push(createCardElement('image', {
      src: 'data:image/png;base64,AAAA', pixelWidth: 1200, pixelHeight: 800, cropX: 25, cropY: 75,
    }))
    const parsed = parseCardDocument(JSON.parse(JSON.stringify(original)))
    expect(parsed).toEqual(original)
    parsed.sides.front.elements[0].x = 19
    expect(original.sides.front.elements[0].x).toBe(7)
  })

  it.each([null, [], {}, { ...createDefaultCard(), version: 2 }])('rejects a malformed or unsupported document: %j', (value) => {
    expect(() => parseCardDocument(value)).toThrow(/vigane|versiooni/)
  })

  it.each([
    { width: 0 }, { height: 151 }, { bleed: -1 }, { bleed: 6 }, { cropMarks: 'false' },
  ])('rejects invalid print dimensions or settings: %j', (changes) => {
    expect(() => parseCardDocument({ ...createDefaultCard(), ...changes })).toThrow()
  })

  it('requires two complete sides and valid background colors', () => {
    const card = createDefaultCard()
    expect(() => parseCardDocument({ ...card, sides: { front: card.sides.front } })).toThrow()
    card.sides.back.background = 'url(https://example.com/image)'
    expect(() => parseCardDocument(card)).toThrow()
  })

  it.each([
    { x: Number.NaN }, { y: Infinity }, { width: 0 }, { height: -3 }, { rotation: 361 },
    { locked: 'true' }, { color: 'red' }, { fontSize: 0 }, { fontWeight: '700' }, { fontFamily: 'unknown' },
  ])('rejects unsafe or mistyped element geometry and style: %j', (changes) => {
    const element = { ...createCardElement('text'), ...changes }
    expect(() => parseCardDocument(cardWith(element as CardElement))).toThrow()
  })

  it('requires unique identifiers across both sides', () => {
    const card = createDefaultCard()
    card.sides.back.elements[0].id = card.sides.front.elements[0].id
    expect(() => parseCardDocument(card)).toThrow()
  })

  it('limits the number of elements before rendering a loaded design', () => {
    const card = cardWith(...Array.from({ length: MAX_ELEMENTS + 1 }, () => createCardElement('shape')))
    expect(() => parseCardDocument(card)).toThrow()
  })

  it.each([
    'javascript:alert(1)', 'https://example.com/logo.png', 'data:image/svg+xml;base64,AAAA',
    'data:text/html;base64,AAAA', 'data:image/png;base64,AAAA" onerror="alert(1)',
  ])('rejects executable, unsupported, or externally loaded image sources: %s', (src) => {
    expect(() => parseCardDocument(cardWith(createCardElement('image', {
      src, pixelWidth: 500, pixelHeight: 500,
    })))).toThrow()
  })

  it.each([{ pixelWidth: 0 }, { pixelHeight: Number.NaN }, { cropX: -1 }, { cropY: 101 }])('validates image resolution and crop position: %j', (changes) => {
    expect(() => parseCardDocument(cardWith(createCardElement('image', {
      src: 'data:image/jpeg;base64,AAAA', pixelWidth: 1200, pixelHeight: 800, ...changes,
    })))).toThrow()
  })

  it('rejects oversized embedded images', () => {
    expect(() => parseCardDocument(cardWith(createCardElement('image', {
      src: `data:image/png;base64,${'A'.repeat(MAX_CARD_BYTES)}`, pixelWidth: 1000, pixelHeight: 1000,
    })))).toThrow(/liiga suur/)
  })
})

describe('print preflight', () => {
  it('accepts the initial two-sided design without warnings', () => {
    expect(getCardIssues(createDefaultCard())).toEqual([])
  })

  it('uses rotated bounds when text crosses the safe area', () => {
    const element = createCardElement('text', { x: 4, y: 3, width: 20, height: 4, rotation: 45 })
    expect(elementBounds(element).top).toBeCloseTo(5 - 12 / Math.sqrt(2), 6)
    expect(getCardIssues(cardWith(element))).toEqual([
      expect.objectContaining({ elementId: element.id, side: 'front', severity: 'warning', message: expect.stringMatching(/lõikeservale/) }),
    ])
  })

  it('identifies the correct side and element when an object is outside the card', () => {
    const card = cardWith()
    const element = createCardElement('shape', { x: 100, y: 10 })
    card.sides.back.elements = [element]
    expect(getCardIssues(card)).toEqual([
      { side: 'back', elementId: element.id, severity: 'error', message: 'Element jääb kaardist välja.' },
    ])
  })

  it('allows decorative shapes to extend into the bleed', () => {
    expect(getCardIssues(cardWith(createCardElement('shape', { x: -3, y: -3, width: 91, height: 61 })))).toEqual([])
  })

  it('checks effective image resolution at print size, including cover cropping', () => {
    const image = createCardElement('image', {
      width: 25.4, height: 25.4, pixelWidth: 600, pixelHeight: 150,
      src: 'data:image/png;base64,AAAA',
    })
    expect(getCardIssues(cardWith(image))).toEqual([
      expect.objectContaining({ elementId: image.id, message: 'Pildi kvaliteet on trükiks madal (150 ppi).' }),
    ])
    image.pixelHeight = 300
    expect(getCardIssues(cardWith(image))).toEqual([])
  })

  it('warns about empty text and QR codes too small to print reliably', () => {
    const text = createCardElement('text', { text: ' \n ' })
    const qr = createCardElement('qr', { width: 12, height: 12 })
    expect(getCardIssues(cardWith(text, qr))).toEqual([
      expect.objectContaining({ elementId: text.id, message: 'Tekst on tühi.' }),
      expect.objectContaining({ elementId: qr.id, message: 'QR-kood on trükiks liiga väike.' }),
    ])
  })
})
