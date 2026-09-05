import fontkit, { type Font } from '@pdf-lib/fontkit'
import type { CardElement } from './model'

const MM_PER_PT = 25.4 / 72
type Family = NonNullable<CardElement['fontFamily']>
type FontKey = `${Family}-${400 | 700}`
const families: Record<Family, string> = { sans: 'NotoSans', serif: 'NotoSerif', mono: 'NotoSansMono' }
const fonts = new Map<FontKey, { bytes: Uint8Array; font: Font }>()
let pending: Promise<void> | undefined

// Match pdf-lib's unpositioned glyph output and the SVG editor exactly.
export const CARD_FONT_FEATURES = { kern: false, liga: false, clig: false, calt: false }
export const CARD_FONT_FEATURE_SETTINGS = '"kern" 0, "liga" 0, "clig" 0, "calt" 0'
export const getCardFontFamily = (family: Family = 'sans') => ({ sans: 'Card Sans', serif: 'Card Serif', mono: 'Card Mono' })[family]
export const getCardFontKey = (element: Pick<CardElement, 'fontFamily' | 'fontWeight'>): FontKey => `${element.fontFamily ?? 'sans'}-${element.fontWeight ?? 400}`

export function ensureCardFonts(): Promise<void> {
  if (!pending) {
    pending = Promise.all(Object.entries(families).flatMap(([family, file]) => ([400, 700] as const).map(async (weight) => {
      const key = `${family}-${weight}` as FontKey
      if (!fonts.has(key)) {
        const response = await fetch(`/fonts/business-card/${file}-${weight === 700 ? 'Bold' : 'Regular'}.ttf`)
        if (!response.ok) throw new Error('Kirjatüüpi ei õnnestunud laadida. Proovi uuesti.')
        const bytes = new Uint8Array(await response.arrayBuffer())
        fonts.set(key, { bytes, font: fontkit.create(bytes) as Font })
      }
      if (typeof document !== 'undefined' && document.fonts) {
        await document.fonts.load(`${weight} 12px "${getCardFontFamily(family as Family)}"`)
      }
    }))).then(() => undefined).catch((error: unknown) => { pending = undefined; throw error })
  }
  return pending
}

export async function cardFontBytes(element: Pick<CardElement, 'fontFamily' | 'fontWeight'>): Promise<Uint8Array> {
  await ensureCardFonts()
  return fonts.get(getCardFontKey(element))!.bytes
}

export type CardTextLine = { text: string; x: number; baseline: number; width: number }
export type CardTextLayout = { lines: CardTextLine[]; height: number; lineHeight: number; overflow: boolean; unsupportedCharacters: string[] }
const layouts = new Map<string, CardTextLayout>()

/** All coordinates are millimetres, relative to the element's top left. */
export function layoutText(element: CardElement): CardTextLayout {
  const cacheKey = JSON.stringify([getCardFontKey(element), element.text, element.fontSize, element.width, element.height, element.textAlign])
  const existing = layouts.get(cacheKey)
  if (existing) return existing
  const cached = fonts.get(getCardFontKey(element))
  if (!cached) throw new Error('Kirjatüübid pole veel laaditud.')
  const { font } = cached
  const size = (element.fontSize ?? 14) * MM_PER_PT
  const scale = size / font.unitsPerEm
  const lineHeight = (font.ascent - font.descent + font.lineGap) * scale
  const text = (element.text ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
  const measure = (value: string) => font.layout(value, CARD_FONT_FEATURES).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) * scale
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { lines.push(''); continue }
    let current = ''
    for (const token of paragraph.match(/\S+|\s+/gu) ?? []) {
      if (measure(current + token) <= element.width || (!current && /^\s+$/.test(token))) {
        current += token
        continue
      }
      if (current.trimEnd()) { lines.push(current.trimEnd()); current = '' }
      if (/^\s+$/.test(token)) continue
      // An address or URL without spaces still wraps, rather than disappearing.
      for (const character of Array.from(token)) {
        if (current && measure(current + character) > element.width) { lines.push(current); current = '' }
        current += character
      }
    }
    lines.push(current.trimEnd())
  }
  const height = lines.length * lineHeight
  const result = lines.map((value, index) => {
    const width = measure(value)
    const x = element.textAlign === 'center' ? (element.width - width) / 2 : element.textAlign === 'right' ? element.width - width : 0
    return { text: value, x, width, baseline: font.ascent * scale + index * lineHeight }
  })
  const unsupportedCharacters = [...new Set(Array.from(text).filter((character) => character !== '\n' && !font.hasGlyphForCodePoint(character.codePointAt(0)!)))]
  const layout = { lines: result, height, lineHeight, overflow: height > element.height + 0.01 || result.some((line) => line.width > element.width + 0.01), unsupportedCharacters }
  if (layouts.size >= 200) layouts.delete(layouts.keys().next().value!)
  layouts.set(cacheKey, layout)
  return layout
}
