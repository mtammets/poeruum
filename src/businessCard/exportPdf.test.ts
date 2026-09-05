import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib'
import { exportBusinessCardPdf } from './exportPdf'
import { CARD_FONT_FEATURES, cardFontBytes, ensureCardFonts, layoutText } from './fonts'
import fontkit from '@pdf-lib/fontkit'
import { createCardElement, createDefaultCard } from './model'
import { getQrMatrix } from './qr'

const mm = (points: number) => points * 25.4 / 72
const decode = (stream: PDFRawStream) => new TextDecoder().decode(decodePDFRawStream(stream).decode())

beforeAll(async () => {
  vi.stubGlobal('fetch', async (path: string) => new Response(await readFile(new URL(`../../public${path}`, import.meta.url))))
  await ensureCardFonts()
})
afterAll(() => vi.unstubAllGlobals())

describe('business-card print PDF', () => {
  it('writes two vector pages with exact trim/bleed sizes, embedded fonts and color-managed output', async () => {
    const document = createDefaultCard()
    document.sides.front.elements.push(createCardElement('text', { text: 'ÕÄÖÜ õäöü ŠŽ', fontSize: 9, y: 1, width: 70, height: 8 }))
    const bytes = await exportBusinessCardPdf(document)
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.6')
    expect(pdf.getPageCount()).toBe(2)
    for (const page of pdf.getPages()) {
      const trim = page.getTrimBox()
      const bleed = page.getBleedBox()
      expect(mm(trim.width)).toBeCloseTo(85, 6)
      expect(mm(trim.height)).toBeCloseTo(55, 6)
      expect(mm(trim.x)).toBeCloseTo(3, 6)
      expect(mm(bleed.width)).toBeCloseTo(91, 6)
      expect(mm(bleed.height)).toBeCloseTo(61, 6)
      expect(mm(page.getWidth())).toBeCloseTo(91, 6)
      expect(page.node.Resources()!.lookup(PDFName.of('ColorSpace'), PDFDict).has(PDFName.of('DefaultRGB'))).toBe(true)
      expect(page.node.lookup(PDFName.of('Group'), PDFDict).lookup(PDFName.of('CS'), PDFName).toString()).toBe('/DeviceCMYK')
      const content = page.node.Contents() as PDFArray
      const operators = content.asArray().map((entry) => decode(pdf.context.lookup(entry) as PDFRawStream)).join('\n')
      expect(operators).toContain('BT\n')
      expect(operators).toContain(' Tj')
      expect(operators).not.toContain(' Do') // No screenshot rasterization.
      const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict)
      for (const [, reference] of fonts.entries()) {
        const font = pdf.context.lookup(reference, PDFDict)
        expect(font.lookup(PDFName.of('BaseFont'), PDFName).toString()).toMatch(/^\/[A-Z]{6}\+Noto/)
        const descendants = font.lookup(PDFName.of('DescendantFonts'), PDFArray)
        const descendant = descendants.lookup(0, PDFDict)
        const descriptor = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict)
        expect(descriptor.lookup(PDFName.of('FontFile2'))).toBeDefined()
        expect(font.lookup(PDFName.of('ToUnicode'))).toBeDefined()
      }
    }
    const intents = pdf.catalog.lookup(PDFName.of('OutputIntents'), PDFArray)
    expect(intents.size()).toBe(1)
    const intent = intents.lookup(0, PDFDict)
    expect(intent.lookup(PDFName.of('S'), PDFName).toString()).toBe('/GTS_PDFX')
    expect(intent.lookup(PDFName.of('OutputConditionIdentifier'), PDFString).decodeText()).toBe('FOGRA51')
    const profile = decodePDFRawStream(intent.lookup(PDFName.of('DestOutputProfile')) as PDFRawStream).decode()
    expect(new TextDecoder().decode(profile.slice(12, 20))).toBe('prtrCMYK')
    const metadata = decode(pdf.catalog.lookup(PDFName.of('Metadata')) as PDFRawStream)
    expect(metadata).toContain('pdfxid:GTS_PDFXVersion="PDF/X-4"')
    expect(metadata).toContain('pdf:Trapped="False"')
    expect(metadata).toContain('xmpMM:VersionID="1"')
    expect(metadata).toMatch(/xmpMM:DocumentID="uuid:[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}"/)
    expect(pdf.context.trailerInfo.ID).toBeDefined()
  })

  it('keeps marks outside the bleed and enlarges only the media box', async () => {
    const document = createDefaultCard()
    document.cropMarks = true
    const pdf = await PDFDocument.load(await exportBusinessCardPdf(document))
    const page = pdf.getPage(0)
    expect(mm(page.getWidth())).toBeCloseTo(101, 6)
    expect(mm(page.getHeight())).toBeCloseTo(71, 6)
    expect(mm(page.getTrimBox().width)).toBeCloseTo(85, 6)
    expect(mm(page.getTrimBox().x)).toBeCloseTo(8, 6)
    expect(mm(page.getBleedBox().x)).toBeCloseTo(5, 6)
    expect(mm(page.getBleedBox().width)).toBeCloseTo(91, 6)
  })

  it('rejects unsupported glyphs instead of silently printing missing characters', async () => {
    const document = createDefaultCard()
    document.sides.front.elements.push(createCardElement('text', { text: '🚀' }))
    await expect(exportBusinessCardPdf(document)).rejects.toThrow('Kirjatüüp ei toeta märke')
  })
})

describe('shared print and editor layout', () => {
  it('uses the embedded font widths, wraps long URLs and preserves explicit empty lines', async () => {
    const element = createCardElement('text', { text: 'ÕÄÖÜ AV\n\nhttps://poeruum.ee/pood/minu-pikk-aadress', width: 28, height: 60, fontSize: 12 })
    const layout = layoutText(element)
    expect(layout.lines[1].text).toBe('')
    expect(layout.lines.length).toBeGreaterThan(3)
    expect(layout.lines.every((line) => line.width <= element.width)).toBe(true)
    expect(layout.unsupportedCharacters).toEqual([])
    const pdf = await PDFDocument.create()
    pdf.registerFontkit(fontkit)
    const font = await pdf.embedFont(await cardFontBytes(element), { features: CARD_FONT_FEATURES })
    for (const line of layout.lines) expect(line.width).toBeCloseTo(mm(font.widthOfTextAtSize(line.text, 12)), 6)
  })

  it('detects text overflow and includes a white QR quiet zone', () => {
    expect(layoutText(createCardElement('text', { text: 'Esimene\nTeine', height: 2 })).overflow).toBe(true)
    const matrix = getQrMatrix('https://poeruum.ee')
    for (let y = 0; y < matrix.size; y++) {
      for (let x = 0; x < matrix.size; x++) {
        if (y < 4 || x < 4 || y >= matrix.size - 4 || x >= matrix.size - 4) expect(matrix.data[y * matrix.size + x]).toBe(0)
      }
    }
    expect(() => getQrMatrix('')).toThrow('Lisa QR-koodi')
  })
})
