import QRCode from 'qrcode'
import jsQR from 'jsqr'

export type StoreQrShape = 'square' | 'round'
type Box = { x: number; y: number; width: number; height: number }
export type StoreQrDesign = {
  url: string
  shape: StoreQrShape
  modules: Box[]
  logoBox: Box | null
  logo: HTMLImageElement | null
  logoBackground: string
}

const SIZE = 1000
const ROUND_PATTERN_RADIUS = 470
export const STORE_QR_PRINT_MM = 50

async function loadLogo(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      image.src = ''
      reject(new Error('Logo laadimine ebaõnnestus. Proovi uuesti või loo kood ilma logota.'))
    }, 10000)
    image.onload = () => { window.clearTimeout(timeout); resolve(image) }
    image.onerror = () => {
      window.clearTimeout(timeout)
      reject(new Error('Logo laadimine ebaõnnestus. Proovi uuesti või loo kood ilma logota.'))
    }
  })
  image.src = url
  return loaded
}

function logoBackground(logo: HTMLImageElement | null): string {
  if (!logo) return '#fff'
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const context = canvas.getContext('2d')!
  context.drawImage(logo, 0, 0, 32, 32)
  const { data } = context.getImageData(0, 0, 32, 32)
  let brightness = 0
  let opacity = 0
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255
    brightness += (data[index] + data[index + 1] + data[index + 2]) / 3 * alpha
    opacity += alpha
  }
  return opacity > 0 && brightness / opacity > 220 && opacity < 32 * 32 * .9 ? '#111' : '#fff'
}

// Keep the logo clear of finder, timing and alignment patterns, including on
// denser codes whose alignment pattern can sit in the middle of the symbol.
function findLogoSpace(modules: QRCode.BitMatrix, ratio: number): Box | null {
  const side = Math.max(3, Math.floor(modules.size * ratio) | 1)
  const centre = (modules.size - side) / 2
  const radius = Math.floor(modules.size * .15)
  let best: Box | null = null
  let distance = Infinity
  for (let y = Math.floor(centre - radius); y <= centre + radius; y++) {
    for (let x = Math.floor(centre - radius); x <= centre + radius; x++) {
      const candidateDistance = (x - centre) ** 2 + (y - centre) ** 2
      if (candidateDistance >= distance) continue
      let clear = true
      for (let row = y; row < y + side && clear; row++) {
        for (let col = x; col < x + side; col++) {
          if (modules.isReserved(row, col)) { clear = false; break }
        }
      }
      if (clear) { best = { x, y, width: side, height: side }; distance = candidateDistance }
    }
  }
  return best
}

function layout(url: string, shape: StoreQrShape, logo: HTMLImageElement | null, background: string, ratio: number, maskPattern?: QRCode.QRCodeMaskPattern): StoreQrDesign {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'H', maskPattern })
  // The square retains its standard quiet zone. In the circular artwork the
  // complete QR fits inside the circle, with a matching pattern extending out
  // to the edge. Never crop or reposition the QR's actual data modules.
  const moduleSize = shape === 'round' ? Math.floor(640 / modules.size) : Math.floor(960 / (modules.size + 8))
  const offset = Math.floor((SIZE - modules.size * moduleSize) / 2)
  const space = logo ? findLogoSpace(modules, ratio) : null
  const boxes: Box[] = []
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (space && x >= space.x && x < space.x + space.width && y >= space.y && y < space.y + space.height) continue
      if (modules.get(y, x)) boxes.push({ x: offset + x * moduleSize, y: offset + y * moduleSize, width: moduleSize, height: moduleSize })
    }
  }
  if (shape === 'round') {
    const padding = Math.ceil(SIZE / moduleSize)
    let seed = maskPattern ?? 8
    for (const char of url) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619)
    for (let y = -padding; y < modules.size + padding; y++) {
      for (let x = -padding; x < modules.size + padding; x++) {
        if (x >= 0 && x < modules.size && y >= 0 && y < modules.size) continue
        // Keep a clear separator around each of the three locating squares.
        if ((x >= -1 && x < 8 && y >= -1 && y < 8)
          || (x >= modules.size - 8 && x <= modules.size && y >= -1 && y < 8)
          || (x >= -1 && x < 8 && y >= modules.size - 8 && y <= modules.size)) continue
        const left = offset + x * moduleSize
        const top = offset + y * moduleSize
        const nearX = Math.max(left, Math.min(SIZE / 2, left + moduleSize)) - SIZE / 2
        const nearY = Math.max(top, Math.min(SIZE / 2, top + moduleSize)) - SIZE / 2
        if (nearX * nearX + nearY * nearY > ROUND_PATTERN_RADIUS ** 2) continue
        let value = seed ^ Math.imul(x + padding, 374761393) ^ Math.imul(y + padding, 668265263)
        value = Math.imul(value ^ (value >>> 13), 1274126177)
        if ((value ^ (value >>> 16)) & 1) boxes.push({ x: left, y: top, width: moduleSize, height: moduleSize })
      }
    }
  }
  return {
    url, shape, modules: boxes, logo, logoBackground: background,
    logoBox: space ? {
      x: offset + (space.x + .65) * moduleSize, y: offset + (space.y + .65) * moduleSize,
      width: (space.width - 1.3) * moduleSize, height: (space.height - 1.3) * moduleSize,
    } : null,
  }
}

function fittedLogo(design: StoreQrDesign): Box | null {
  const { logo, logoBox } = design
  if (!logo || !logoBox) return null
  const scale = Math.min(logoBox.width / logo.naturalWidth, logoBox.height / logo.naturalHeight)
  const width = logo.naturalWidth * scale
  const height = logo.naturalHeight * scale
  return { x: logoBox.x + (logoBox.width - width) / 2, y: logoBox.y + (logoBox.height - height) / 2, width, height }
}

export function renderStoreQr(design: StoreQrDesign, pixels = 1000, opaque = false): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = pixels
  const context = canvas.getContext('2d')!
  context.scale(pixels / SIZE, pixels / SIZE)
  context.fillStyle = '#fff'
  if (opaque || design.shape === 'square') context.fillRect(0, 0, SIZE, SIZE)
  if (design.shape === 'round') {
    context.beginPath()
    context.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 3, 0, 2 * Math.PI)
    context.fill()
  }
  context.save()
  if (design.shape === 'round') {
    context.beginPath()
    context.arc(SIZE / 2, SIZE / 2, ROUND_PATTERN_RADIUS, 0, 2 * Math.PI)
    context.clip()
  }
  context.fillStyle = '#000'
  context.beginPath()
  design.modules.forEach(({ x, y, width, height }) => context.rect(x, y, width, height))
  context.fill()
  context.restore()
  const fitted = fittedLogo(design)
  if (design.logo && design.logoBox && fitted) {
    const box = design.logoBox
    context.fillStyle = design.logoBackground
    context.fillRect(box.x, box.y, box.width, box.height)
    context.drawImage(design.logo, fitted.x, fitted.y, fitted.width, fitted.height)
  }
  return canvas
}

export async function createStoreQr(url: string, shape: StoreQrShape, logoUrl: string | null): Promise<StoreQrDesign> {
  const target = new URL(url)
  if (!['https:', 'http:'].includes(target.protocol)) throw new Error('Poe aadress ei ole korrektne.')
  const logo = logoUrl ? await loadLogo(logoUrl) : null
  const background = logoBackground(logo)
  for (const ratio of [.24, .20, .16]) {
    // The best mask for a plain code can be harder to detect with a logo.
    for (const mask of [undefined, 0, 1, 2, 3, 4, 5, 6, 7] as const) {
      const design = layout(url, shape, logo, background, ratio, mask)
      if (logo && !design.logoBox) continue
      // Validate the completed artwork, not just the unbranded QR matrix.
      const readable = [500, 300].every((pixels) => {
        const canvas = renderStoreQr(design, pixels, true)
        const image = canvas.getContext('2d')!.getImageData(0, 0, pixels, pixels)
        return jsQR(image.data, pixels, pixels, { inversionAttempts: 'dontInvert' })?.data === url
      })
      if (readable) return design
    }
  }
  throw new Error('Selle logoga ei õnnestunud loetavat QR-koodi luua. Proovi ilma logota.')
}

export async function exportStoreQrPng(design: StoreQrDesign): Promise<Blob> {
  const canvas = renderStoreQr(design, 2000)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob)
    else reject(new Error('Pildifaili loomine ebaõnnestus. Proovi uuesti.'))
  }, 'image/png'))
}

export async function exportStoreQrPdf(design: StoreQrDesign, storeName: string): Promise<Blob> {
  const { PDFDocument, cmyk, rgb, pushGraphicsState, popGraphicsState, drawEllipsePath, clip, endPath } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${storeName} — QR-kood`)
  const size = STORE_QR_PRINT_MM * 72 / 25.4
  const unit = size / SIZE
  const page = pdf.addPage([size, size])
  page.drawRectangle({ x: 0, y: 0, width: size, height: size, color: rgb(1, 1, 1) })
  page.pushOperators(pushGraphicsState())
  if (design.shape === 'round') page.pushOperators(
    ...drawEllipsePath({ x: size / 2, y: size / 2, xScale: ROUND_PATTERN_RADIUS * unit, yScale: ROUND_PATTERN_RADIUS * unit }), clip(), endPath(),
  )
  page.drawSvgPath(design.modules.map(({ x, y, width, height }) => `M${x} ${y}h${width}v${height}h-${width}Z`).join(' '), {
    x: 0, y: size, scale: unit, color: cmyk(0, 0, 0, 1),
  })
  page.pushOperators(popGraphicsState())
  const fitted = fittedLogo(design)
  if (design.logo && design.logoBox && fitted) {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1000 / Math.max(design.logo.naturalWidth, design.logo.naturalHeight))
    canvas.width = Math.max(1, Math.round(design.logo.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(design.logo.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(design.logo, 0, 0, canvas.width, canvas.height)
    const image = await pdf.embedPng(canvas.toDataURL('image/png'))
    const box = design.logoBox
    page.drawRectangle({ x: box.x * unit, y: size - (box.y + box.height) * unit, width: box.width * unit, height: box.height * unit,
      color: design.logoBackground === '#fff' ? rgb(1, 1, 1) : rgb(17 / 255, 17 / 255, 17 / 255) })
    page.drawImage(image, { x: fitted.x * unit, y: size - (fitted.y + fitted.height) * unit, width: fitted.width * unit, height: fitted.height * unit })
  }
  return new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' })
}
