import fontkit from '@pdf-lib/fontkit'
import {
  PDFDocument, PDFDict, PDFHexString, PDFName, PDFString,
  clip, cmyk, concatTransformationMatrix, endPath, popGraphicsState,
  pushGraphicsState, rectangle, rgb, type PDFFont, type PDFImage, type PDFPage,
} from 'pdf-lib'
import { CARD_FONT_FEATURES, cardFontBytes, ensureCardFonts, getCardFontKey, layoutText } from './fonts'
import { parseCardDocument, type CardDocument, type CardElement } from './model'
import { getQrMatrix } from './qr'

const PT_PER_MM = 72 / 25.4
export const PDF_EXPORT_LABEL = 'PDF/X-4 · FOGRA51'
export const PDF_OUTPUT_PROFILE = 'PSO Coated v3 (FOGRA51)'
const pt = (millimetres: number) => millimetres * PT_PER_MM
const subsetNames: Record<string, string> = {
  'sans-400': 'SANSRG+NotoSans-Regular', 'sans-700': 'SANSBD+NotoSans-Bold',
  'serif-400': 'SERFRG+NotoSerif-Regular', 'serif-700': 'SERFBD+NotoSerif-Bold',
  'mono-400': 'MONORG+NotoSansMono-Regular', 'mono-700': 'MONOBD+NotoSansMono-Bold',
}

let templatePromise: Promise<Uint8Array> | undefined
let sourceProfilePromise: Promise<Uint8Array> | undefined
async function asset(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Trükiseadeid ei õnnestunud laadida. Proovi uuesti.')
  return new Uint8Array(await response.arrayBuffer())
}
const printTemplate = () => templatePromise ??= asset('/print/output-intent.pdf').catch((error: unknown) => { templatePromise = undefined; throw error })
const sourceProfile = () => sourceProfilePromise ??= asset('/print/sRGB-v2-magic.icc').catch((error: unknown) => { sourceProfilePromise = undefined; throw error })

function color(hex = '#000000') {
  // True black remains a single process ink, especially for small text and QR.
  if (hex.toLowerCase() === '#000000') return cmyk(0, 0, 0, 1)
  return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255)
}

/** Decode through the browser's color management, then explicitly encode sRGB. */
async function normalizeImage(src: string): Promise<string> {
  const image = new Image()
  image.src = src
  await image.decode().catch(() => { throw new Error('Pilti ei õnnestunud avada. Lisa pilt uuesti.') })
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { colorSpace: 'srgb' })
  if (!context || !canvas.width || !canvas.height) throw new Error('Pilti ei õnnestunud trükifaili lisada.')
  context.drawImage(image, 0, 0)
  const result = canvas.toDataURL('image/png')
  canvas.width = 0
  canvas.height = 0
  if (!result.startsWith('data:image/png;')) throw new Error('Pilt on trükifaili jaoks liiga suur.')
  return result
}

function drawCropMarks(page: PDFPage, document: CardDocument, margin: number) {
  const left = pt(margin + document.bleed)
  const right = left + pt(document.width)
  const bottom = pt(margin + document.bleed)
  const top = bottom + pt(document.height)
  const outerLeft = pt(margin)
  const outerRight = pt(margin + document.bleed * 2 + document.width)
  const outerBottom = pt(margin)
  const outerTop = pt(margin + document.bleed * 2 + document.height)
  const length = pt(3)
  const gap = pt(1)
  for (const x of [left, right]) {
    page.drawLine({ start: { x, y: outerBottom - gap }, end: { x, y: outerBottom - gap - length }, color: cmyk(1, 1, 1, 1), thickness: 0.25 })
    page.drawLine({ start: { x, y: outerTop + gap }, end: { x, y: outerTop + gap + length }, color: cmyk(1, 1, 1, 1), thickness: 0.25 })
  }
  for (const y of [bottom, top]) {
    page.drawLine({ start: { x: outerLeft - gap, y }, end: { x: outerLeft - gap - length, y }, color: cmyk(1, 1, 1, 1), thickness: 0.25 })
    page.drawLine({ start: { x: outerRight + gap, y }, end: { x: outerRight + gap + length, y }, color: cmyk(1, 1, 1, 1), thickness: 0.25 })
  }
}

function drawElement(page: PDFPage, element: CardElement, document: CardDocument, inset: number, font?: PDFFont, image?: PDFImage) {
  const width = pt(element.width)
  const height = pt(element.height)
  const centreX = pt(inset + element.x + element.width / 2)
  const centreY = pt(inset + document.height - element.y - element.height / 2)
  const radians = -element.rotation * Math.PI / 180
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), centreX, centreY), concatTransformationMatrix(1, 0, 0, 1, -width / 2, -height / 2))
  if (element.type === 'text' && font) {
    page.pushOperators(rectangle(0, 0, width, height), clip(), endPath())
    for (const line of layoutText(element).lines) {
      if (line.text) page.drawText(line.text, { x: pt(line.x), y: height - pt(line.baseline), font, size: element.fontSize ?? 14, color: color(element.color) })
    }
  } else if (element.type === 'image' && image) {
    page.pushOperators(rectangle(0, 0, width, height), clip(), endPath())
    const scale = Math.max(width / image.width, height / image.height)
    const drawnWidth = image.width * scale
    const drawnHeight = image.height * scale
    const x = (width - drawnWidth) * (element.cropX ?? 50) / 100
    const top = (height - drawnHeight) * (element.cropY ?? 50) / 100
    page.drawImage(image, { x, y: height - top - drawnHeight, width: drawnWidth, height: drawnHeight })
  } else if (element.type === 'shape') {
    if (element.shape === 'ellipse') page.drawEllipse({ x: width / 2, y: height / 2, xScale: width / 2, yScale: height / 2, color: color(element.color) })
    else if (element.shape === 'line') page.drawLine({ start: { x: 0, y: height / 2 }, end: { x: width, y: height / 2 }, thickness: height, color: color(element.color) })
    else page.drawRectangle({ x: 0, y: 0, width, height, color: color(element.color) })
  } else if (element.type === 'qr') {
    const matrix = getQrMatrix(element.qrValue ?? '')
    const edge = Math.min(width, height)
    const unit = edge / matrix.size
    const left = (width - edge) / 2
    const bottom = (height - edge) / 2
    page.drawRectangle({ x: left, y: bottom, width: edge, height: edge, color: rgb(1, 1, 1) })
    // Contiguous runs preserve vector output without thousands of tiny objects.
    for (let row = 0; row < matrix.size; row++) {
      for (let column = 0; column < matrix.size; column++) {
        if (!matrix.data[row * matrix.size + column]) continue
        const start = column
        while (column + 1 < matrix.size && matrix.data[row * matrix.size + column + 1]) column++
        page.drawRectangle({ x: left + start * unit, y: bottom + (matrix.size - row - 1) * unit, width: (column - start + 1) * unit, height: unit, color: color(element.color) })
      }
    }
  }
  page.pushOperators(popGraphicsState())
}

function setPrintMetadata(pdf: PDFDocument, date: Date) {
  const title = 'Poeruum — visiitkaart'
  const creator = 'Poeruum'
  const subject = 'Esikülg ja tagakülg; PSO Coated v3 (FOGRA51)'
  pdf.setTitle(title)
  pdf.setAuthor(creator)
  pdf.setCreator(creator)
  pdf.setProducer(creator)
  pdf.setSubject(subject)
  pdf.setCreationDate(date)
  pdf.setModificationDate(date)
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info, PDFDict)
  info.set(PDFName.of('Trapped'), PDFName.of('False'))
  info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of('PDF/X-4'))
  const idBytes = crypto.getRandomValues(new Uint8Array(16))
  idBytes[6] = (idBytes[6] & 0x0f) | 0x40
  idBytes[8] = (idBytes[8] & 0x3f) | 0x80
  const id = Array.from(idBytes, (value) => value.toString(16).padStart(2, '0')).join('')
  const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
  pdf.context.trailerInfo.ID = pdf.context.obj([PDFHexString.of(id), PDFHexString.of(id)])
  const metadata = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Poeruum"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:dc="http://purl.org/dc/elements/1.1/" pdfxid:GTS_PDFXVersion="PDF/X-4" pdf:Producer="${creator}" pdf:Trapped="False" xmp:CreatorTool="${creator}" xmp:CreateDate="${date.toISOString()}" xmp:ModifyDate="${date.toISOString()}" xmp:MetadataDate="${date.toISOString()}" xmpMM:DocumentID="uuid:${uuid}" xmpMM:InstanceID="uuid:${uuid}" xmpMM:VersionID="1">
<dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title><dc:description><rdf:Alt><rdf:li xml:lang="x-default">${subject}</rdf:li></rdf:Alt></dc:description><dc:creator><rdf:Seq><rdf:li>${creator}</rdf:li></rdf:Seq></dc:creator>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`
  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(pdf.context.stream(new TextEncoder().encode(metadata), { Type: 'Metadata', Subtype: 'XML' })))
}

/** Two single-up pages, front then back, with vectors, embedded fonts and ICCs. */
export async function exportBusinessCardPdf(value: CardDocument): Promise<Uint8Array> {
  const document = parseCardDocument(value)
  const [template, profile] = await Promise.all([printTemplate(), sourceProfile(), ensureCardFonts()])
  const pdf = await PDFDocument.load(template, { updateMetadata: false })
  while (pdf.getPageCount()) pdf.removePage(0)
  pdf.registerFontkit(fontkit)
  setPrintMetadata(pdf, new Date())
  const sourceICC = pdf.context.register(pdf.context.flateStream(profile, { N: 3, Alternate: 'DeviceRGB' }))
  const rgbColorSpace = pdf.context.obj([PDFName.of('ICCBased'), sourceICC])
  const fonts = new Map<string, PDFFont>()
  const images = new Map<string, PDFImage>()
  for (const side of [document.sides.front, document.sides.back]) {
    for (const element of side.elements) {
      if (element.type === 'text') {
        const layout = layoutText(element)
        if (layout.unsupportedCharacters.length) throw new Error(`Kirjatüüp ei toeta märke: ${layout.unsupportedCharacters.join(' ')}`)
        const key = getCardFontKey(element)
        if (!fonts.has(key)) fonts.set(key, await pdf.embedFont(await cardFontBytes(element), { subset: true, customName: subsetNames[key], features: CARD_FONT_FEATURES }))
      } else if (element.type === 'image' && element.src && !images.has(element.src)) {
        images.set(element.src, await pdf.embedPng(await normalizeImage(element.src)))
      }
    }
  }
  const margin = document.cropMarks ? 5 : 0
  const inset = margin + document.bleed
  for (const side of [document.sides.front, document.sides.back]) {
    const page = pdf.addPage([pt(document.width + inset * 2), pt(document.height + inset * 2)])
    page.setTrimBox(pt(inset), pt(inset), pt(document.width), pt(document.height))
    page.setBleedBox(pt(margin), pt(margin), pt(document.width + document.bleed * 2), pt(document.height + document.bleed * 2))
    page.node.Resources()!.set(PDFName.of('ColorSpace'), pdf.context.obj({ DefaultRGB: rgbColorSpace }))
    // Blend using the process inks of the print output intent. In particular,
    // pure K text must not make a round trip through an RGB page group.
    page.node.set(PDFName.of('Group'), pdf.context.obj({ Type: 'Group', S: 'Transparency', CS: 'DeviceCMYK', I: true }))
    page.pushOperators(pushGraphicsState(), rectangle(pt(margin), pt(margin), pt(document.width + document.bleed * 2), pt(document.height + document.bleed * 2)), clip(), endPath())
    page.drawRectangle({ x: pt(margin), y: pt(margin), width: pt(document.width + document.bleed * 2), height: pt(document.height + document.bleed * 2), color: color(side.background) })
    for (const element of side.elements) drawElement(page, element, document, inset, fonts.get(getCardFontKey(element)), element.src ? images.get(element.src) : undefined)
    page.pushOperators(popGraphicsState())
    if (document.cropMarks) drawCropMarks(page, document, margin)
  }
  const bytes = await pdf.save({ useObjectStreams: false })
  // pdf-lib hardcodes a 1.7 header, ignoring context.header. The supported
  // objects above use only PDF 1.6 features, as required by PDF/X-4.
  bytes[7] = '6'.charCodeAt(0)
  return bytes
}
