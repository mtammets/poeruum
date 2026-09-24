import { PDFDocument, rgb, type PDFFont } from 'npm:pdf-lib@^1.17.1'
import fontkit from 'npm:@pdf-lib/fontkit@^1.1.1'
import type { InvoiceDocument } from '../../../shared/order-invoice.ts'
import { notoSansBase64 } from './invoice-font/noto-sans.ts'
import { embedInvoiceLogo } from './order-invoice-logo.ts'

const date = (value: string) => new Intl.DateTimeFormat('et-EE', { dateStyle: 'medium', timeZone: 'Europe/Tallinn' }).format(new Date(value))
const money = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

const wrap = (text: string, font: PDFFont, size: number, width: number) => {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue }
    if (line) lines.push(line)
    line = ''
    for (const character of word) {
      if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = '' }
      line += character
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

export async function renderOrderInvoice(document: InvoiceDocument): Promise<Uint8Array> {
  if (document.snapshot.version !== 1) throw new Error('Arve vormingu versioon ei ole toetatud.')
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(notoSansBase64, { subset: true })
  const snapshot = document.snapshot
  const credit = document.kind === 'credit'
  const sign = credit ? -1 : 1
  const title = `${credit ? 'Kreeditarve' : 'Arve'} ${document.number}`
  pdf.setTitle(title)
  pdf.setAuthor(snapshot.seller.name)
  pdf.setCreator('Poeruum')
  pdf.setCreationDate(new Date(document.issued_at))
  pdf.setModificationDate(new Date(document.issued_at))
  let page = pdf.addPage([595.28, 841.89])
  let y = 795
  const ink = rgb(.12, .13, .14)
  const muted = rgb(.35, .37, .4)
  const draw = (value: string, x: number, top: number, size = 10, color = ink) => page.drawText(value, { x, y: top, size, font, color })
  const right = (value: string, x: number, top: number, size = 10) => draw(value, x - font.widthOfTextAtSize(value, size), top, size)
  const newPage = () => {
    page = pdf.addPage([595.28, 841.89]); y = 795
    draw(title, 42, y, 13); y -= 30
  }
  const reserve = (height: number) => { if (y - height < 65) newPage() }
  const paragraph = (value: string, size = 10) => {
    for (const line of wrap(value, font, size, 510)) { reserve(size + 6); draw(line, 42, y, size); y -= size + 6 }
  }
  const logo = await embedInvoiceLogo(pdf, snapshot.storeLogo)
  if (logo) {
    const size = logo.scaleToFit(160, 52)
    page.drawImage(logo, { x: 42, y: 802 - size.height, ...size })
    y = 802 - size.height - 26
  }
  paragraph(title, 23)
  if (document.stripe_mode === 'test') paragraph('TESTARVE · Katsemakse', 11)
  paragraph(`${credit ? 'Tagastus kinnitatud' : 'Tasutud'} · ${date(document.issued_at)}`, 11)
  paragraph(`Tellimus ${document.order_number}`)
  paragraph(`Arve kuupäev: ${date(document.issued_at)}`)
  paragraph(`${credit ? 'Algse makse' : 'Makse'} kuupäev: ${date(document.paid_at)}`)
  if (document.original_number) paragraph(`Algne arve: ${document.original_number}`)
  y -= 16
  const seller = ['MÜÜJA', snapshot.seller.name, `Registrikood: ${snapshot.seller.registryCode}`, snapshot.seller.address,
    snapshot.seller.email, ...(snapshot.seller.vatNumber ? [`KMKR: ${snapshot.seller.vatNumber}`] : [])]
  const buyer = ['OSTJA', snapshot.buyer.name, ...(snapshot.buyer.registryCode ? [`Registrikood: ${snapshot.buyer.registryCode}`] : []),
    snapshot.buyer.address, snapshot.buyer.email, ...(snapshot.buyer.vatNumber ? [`KMKR: ${snapshot.buyer.vatNumber}`] : [])]
  const sellerLines = seller.flatMap((value) => wrap(value, font, 10, 242))
  const buyerLines = buyer.flatMap((value) => wrap(value, font, 10, 242))
  reserve(Math.max(sellerLines.length, buyerLines.length) * 15 + 24)
  sellerLines.forEach((line, index) => draw(line, 42, y - index * 15))
  buyerLines.forEach((line, index) => draw(line, 309, y - index * 15))
  y -= Math.max(sellerLines.length, buyerLines.length) * 15 + 24
  const tableHeader = () => {
    draw('Toode / teenus', 42, y, 9, muted)
    right('Kogus', 304, y, 9); right('Hind KM-ta', 393, y, 9)
    right('KM', 439, y, 9); right('Rida KM-ta', 553, y, 9)
    y -= 12
    page.drawLine({ start: { x: 42, y }, end: { x: 553, y }, thickness: .6, color: rgb(.8, .81, .82) })
    y -= 19
  }
  reserve(55); tableHeader()
  for (const line of snapshot.lines) {
    const names = wrap([line.name, line.options].filter(Boolean).join(' · '), font, 9, 223)
    // Inputs are bounded; exceptionally long option descriptions can span pages.
    let first = true
    for (const name of names) {
      if (y < 90) { newPage(); tableHeader() }
      draw(name, 42, y, 9)
      if (first) {
        right(String(line.quantity), 304, y, 9)
        const unitNet = line.unitGrossCents / (snapshot.vatRate === null ? 1 : 1 + snapshot.vatRate / 100)
        right((sign * unitNet / 100).toFixed(4).replace('.', ','), 393, y, 9)
        right(snapshot.vatRate === null ? '—' : `${snapshot.vatRate}%`, 439, y, 9)
        right(money(sign * line.netCents), 553, y, 9)
      }
      first = false; y -= 14
    }
    y -= 9
  }
  reserve(165); y -= 12
  draw('Kokku käibemaksuta', 309, y); right(`${money(sign * snapshot.netCents)} €`, 553, y); y -= 21
  if (snapshot.vatRate !== null) {
    draw(`Käibemaks ${snapshot.vatRate}%`, 309, y); right(`${money(sign * snapshot.vatCents)} €`, 553, y); y -= 21
  }
  draw(credit ? 'Krediteeritud kokku' : 'Kokku tasutud', 309, y, 12)
  right(`${money(sign * snapshot.totalCents)} €`, 553, y, 12); y -= 32
  if (snapshot.vatRate === null) paragraph('Müüja ei ole käibemaksukohustuslane.')
  paragraph(credit ? 'Makse on tagastatud. Kreeditarve muudab eespool viidatud algset arvet.' : 'Tasutud Stripe’i kaudu. Tasuda jäänud: 0,00 €.')
  paragraph(`Tarne: ${snapshot.delivery}`, 9)
  const pages = pdf.getPages()
  pages.forEach((sheet, index) => {
    sheet.drawText(`Koostatud müüja nimel Poeruumis · ${index + 1} / ${pages.length}`, { x: 42, y: 34, size: 8, font, color: muted })
  })
  return pdf.save()
}
