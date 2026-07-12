import AppKit
import CoreGraphics

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Veidrad_Asjad_e-poe_pakkumine.pdf"
let page = CGRect(x: 0, y: 0, width: 595, height: 842)
var mediaBox = page
guard let ctx = CGContext(URL(fileURLWithPath: out) as CFURL, mediaBox: &mediaBox, nil) else { fatalError("PDF") }
let ink = NSColor(calibratedWhite: 0.07, alpha: 1)
let muted = NSColor(calibratedWhite: 0.39, alpha: 1)
let line = NSColor(calibratedWhite: 0.87, alpha: 1)
let acid = NSColor(calibratedRed: 0.90, green: 0.95, blue: 0.35, alpha: 1)
let margin: CGFloat = 48

func font(_ size: CGFloat, _ weight: NSFont.Weight = .regular) -> NSFont { NSFont.systemFont(ofSize: size, weight: weight) }

@discardableResult func text(_ value: String, _ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ size: CGFloat = 9, _ weight: NSFont.Weight = .regular, _ color: NSColor = ink, _ spacing: CGFloat = 2) -> CGFloat {
  let p = NSMutableParagraphStyle(); p.lineSpacing = spacing
  let a: [NSAttributedString.Key: Any] = [.font: font(size, weight), .foregroundColor: color, .paragraphStyle: p]
  let h = ceil((value as NSString).boundingRect(with: CGSize(width: width, height: 1000), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: a).height)
  (value as NSString).draw(with: CGRect(x: x, y: page.height-y-h, width: width, height: h), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: a)
  return h
}

func rule(_ y: CGFloat) {
  ctx.setStrokeColor(line.cgColor); ctx.setLineWidth(1)
  ctx.move(to: CGPoint(x: margin, y: page.height-y)); ctx.addLine(to: CGPoint(x: page.width-margin, y: page.height-y)); ctx.strokePath()
}

func item(_ value: String, _ x: CGFloat, _ y: CGFloat, _ width: CGFloat) -> CGFloat {
  ctx.setFillColor(acid.cgColor); ctx.fillEllipse(in: CGRect(x: x, y: page.height-y-7, width: 6, height: 6))
  return text(value, x+15, y, width-15, 8.7, .regular, muted, 2.5)
}

ctx.beginPDFPage(nil)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
ctx.setFillColor(NSColor.white.cgColor); ctx.fill(page)
ctx.setFillColor(acid.cgColor); ctx.fill(CGRect(x: 0, y: 0, width: 10, height: page.height))

text("PAKKUMINE", margin, 48, 180, 9, .bold)
text("12.07.2026", 455, 48, 92, 8, .medium, muted)
rule(70)
text("Veidrad Asjad e-pood", margin, 103, 350, 25, .bold, ink, 0)
text("Klient: [kliendi nimi / ettevõte]", margin, 145, 270, 8.5, .medium, muted)
text("Teostaja: [nimi / ettevõte]", 322, 145, 225, 8.5, .medium, muted)

rule(176)
text("Tööde kirjeldus", margin, 207, 220, 13, .bold)
let left = margin, right: CGFloat = 305, col: CGFloat = 242
var yl: CGFloat = 240, yr: CGFloat = 240
let leftItems = [
  "Mobiili-, tahvli- ja arvutivaadete UX/UI disain",
  "Tootevoog, otsing, jagamine ja ostukorv",
  "Tootegalerii kuni kolme fotoga",
  "Tava- ja soodushindade kuvamine",
  "Kassa: kontaktandmed, tellimuse read, KM ja kogusumma",
  "Pangalingid ja kaardimakse"
]
let rightItems = [
  "Omniva pakiautomaat, kuller ja järeletulemine",
  "In-AKS täpne Eesti aadressiotsing",
  "Sisselogimisega toodete ja fotode haldus",
  "Backend, andmebaas, tellimused ja failide salvestus",
  "Tehniline SEO, analüütika ja jõudluse seadistus",
  "Testimine, produktsiooni avalikustamine ja üleandmine"
]
for v in leftItems { yl += item(v, left, yl, col) + 13 }
for v in rightItems { yr += item(v, right, yr, col) + 13 }

rule(468)
text("Hind", margin, 501, 100, 12, .bold)
text("5 900 € + km", margin, 530, 230, 28, .bold)
text("Fikseeritud hind kirjeldatud töömahule.", margin, 570, 230, 8.3, .regular, muted)

text("Ajakava", 322, 501, 100, 12, .bold)
text("6–8 nädalat", 322, 532, 210, 18, .bold)
text("Alates ettemaksust ja vajalike ligipääsude andmisest.", 322, 570, 225, 8.3, .regular, muted)

rule(608)
text("Maksetingimused", margin, 640, 160, 11, .bold)
text("40% alustamisel  ·  40% beetaversiooni valmimisel  ·  20% avalikustamisel", margin, 668, 499, 8.8, .medium, muted)

text("Hind sisaldab", margin, 710, 120, 9, .bold)
text("2 disaini parandusringi · lähtekood ja dokumentatsioon · 30 päeva veaparandust pärast avalikustamist", margin, 733, 499, 8.2, .regular, muted)

text("Hind ei sisalda", margin, 769, 120, 9, .bold)
text("Makseteenuse, transpordi, veebimajutuse ja muude kolmandate osapoolte tasusid ning kinnitatud mahust väljapoole jäävaid lisatöid.", margin, 792, 499, 7.8, .regular, muted, 2)

NSGraphicsContext.restoreGraphicsState()
ctx.endPDFPage()
ctx.closePDF()
print(out)
