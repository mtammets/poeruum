import { contentDuration, mediaSource } from './phoneContent'
import type { CampaignDocument, CampaignMedia } from './model'
import { sceneElements, sceneKey, type SceneKey } from './layout'

export type CampaignAssets = { images: HTMLImageElement[]; mark: HTMLImageElement }
export type FrameOptions = { format: 'reel' | 'post' | 'story'; index?: number; time?: number; phoneFrame?: CanvasImageSource }
export const DURATION = 12
const colors = { cream: '#f4f2e9', green: '#265f43', ink: '#17231c', lime: '#e5f25a', sage: '#dbe6c4' }
let fontReady: Promise<void> | undefined

async function loadImage(src: string) {
  const image = new Image()
  image.decoding = 'async'
  image.src = src
  await image.decode()
  return image
}
export async function loadCampaignAssets(doc: CampaignDocument): Promise<CampaignAssets> {
  fontReady ??= (async () => {
    const font = new FontFace('CampaignManrope', 'url(/campaigns/manrope.woff2)', { weight: '200 800' })
    document.fonts.add(await font.load())
  })().catch((error) => { fontReady = undefined; throw error })
  const [images, mark] = await Promise.all([Promise.all(doc.media.map((m) => loadImage(mediaSource(doc, m.src)))), loadImage('/campaigns/brand.svg'), fontReady])
  return { images, mark }
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, fill: string) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill()
}
function lines(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const result: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (ctx.measureText(word).width > width) {
      if (line) { result.push(line); line = '' }
      for (const letter of word) {
        if (ctx.measureText(line + letter).width > width) { result.push(line); line = letter } else line += letter
      }
    } else if (line && ctx.measureText(`${line} ${word}`).width > width) { result.push(line); line = word }
    else line = line ? `${line} ${word}` : word
  }
  if (line) result.push(line)
  return result
}
function textBlock(ctx: CanvasRenderingContext2D, text: string, y: number, { size = 76, width = 850, maxLines = 2, color = colors.ink, weight = 800, serif = false, boxHeight = 0 } = {}) {
  if (!text.trim()) return 0
  let rows: string[]
  do {
    ctx.font = `${serif ? 'italic ' : ''}${weight} ${size}px ${serif ? 'Georgia' : 'CampaignManrope'}, sans-serif`
    rows = lines(ctx, text, width)
    if (rows.length <= maxLines) break
    size -= 2
  } while (size > 24)
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  y += Math.max(0, (boxHeight - rows.length * size * 1.14) / 2)
  rows.forEach((row, n) => ctx.fillText(row, 540, y + n * size * 1.14))
  return rows.length * size * 1.14
}
function brand(ctx: CanvasRenderingContext2D, mark: HTMLImageElement, y: number, h = 70, light = false) {
  const fontSize = h * .68
  ctx.font = `800 ${fontSize}px CampaignManrope, sans-serif`
  const width = ctx.measureText('Poeruum').width + h * 1.25
  const x = (1080 - width) / 2
  ctx.drawImage(mark, x, y, h, h)
  ctx.fillStyle = light ? colors.cream : colors.ink
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText('Poeruum', x + h * 1.25, y + h / 2)
}
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, cropScreen = false) {
  const sw = img.naturalWidth, sh = img.naturalHeight * (cropScreen ? .65 : 1)
  const scale = Math.max(w / sw, h / sh)
  const cw = w / scale, ch = h / scale
  ctx.drawImage(img, (sw - cw) / 2, (sh - ch) / 2 + (cropScreen ? img.naturalHeight * .16 : 0), cw, ch, x, y, w, h)
}
function photo(ctx: CanvasRenderingContext2D, img: HTMLImageElement, media: CampaignMedia, x: number, y: number, w: number, h: number, rotation = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rotation)
  ctx.shadowColor = '#17231c30'; ctx.shadowBlur = 45; ctx.shadowOffsetY = 24
  rounded(ctx, -w / 2 - 12, -h / 2 - 12, w + 24, h + 24, 34, colors.cream)
  ctx.shadowColor = 'transparent'
  ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 25); ctx.clip()
  cover(ctx, img, -w / 2, -h / 2, w, h, media.kind === 'screen')
  ctx.restore()
}
function phone(ctx: CanvasRenderingContext2D, images: HTMLImageElement[], media: CampaignMedia[], index: number, y: number, width: number, time: number, animated: boolean, phoneFrame?: CanvasImageSource) {
  const height = width * 1.98
  ctx.save(); ctx.translate(540, y)
  ctx.shadowColor = '#17231c35'; ctx.shadowBlur = 55; ctx.shadowOffsetY = 32
  rounded(ctx, -width / 2, -height / 2, width, height, width * .14, colors.ink)
  ctx.shadowColor = 'transparent'
  ctx.strokeStyle = '#40624b'; ctx.lineWidth = 3; ctx.stroke()
  ctx.beginPath(); ctx.roundRect(-width / 2 + 18, -height / 2 + 18, width - 36, height - 36, width * .11); ctx.clip()
  const x = -width / 2 + 18, top = -height / 2 + 18, w = width - 36, h = height - 36
  if (phoneFrame) ctx.drawImage(phoneFrame, x, top, w, h)
  else {
    // Custom images retain their own content: scroll tall shop screenshots and
    // slide between products, rather than substituting the reference shop video.
    const phase = animated ? Math.min(time, 8.7) % 3 : 0
    const p = animated && index < 2 ? Math.max(0, Math.min(1, (phase - 2.35) / .65)) : 0
    const slide = p * p * (3 - 2 * p)
    const drawImage = (i: number, offset: number, elapsed: number) => {
      const image = images[i]
      const scaledHeight = image.naturalHeight * w / image.naturalWidth
      if (media[i].kind === 'screen' && scaledHeight > h + 10) {
        const travel = animated ? (1 - Math.cos(Math.min(elapsed / 2.35, 1) * Math.PI * 2)) / 2 : 0
        ctx.drawImage(image, x + offset, top - (scaledHeight - h) * travel, w, scaledHeight)
      } else cover(ctx, image, x + offset, top, w, h)
    }
    drawImage(index, -w * slide, phase)
    if (slide > 0) drawImage(index + 1, w * (1 - slide), 0)
  }
  if (!phoneFrame && media[index].kind === 'photo') {
    const gradient = ctx.createLinearGradient(0, -height / 2, 0, -height / 2 + 180)
    gradient.addColorStop(0, '#17231cbb'); gradient.addColorStop(1, '#17231c00')
    ctx.fillStyle = gradient; ctx.fillRect(-width / 2, -height / 2, width, 180)
    ctx.font = '700 24px CampaignManrope'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = '#ffffff'
    ctx.fillText('Sinu pood', -width / 2 + 45, -height / 2 + 55)
  }
  ctx.restore()
}

export function drawCampaignFrame(canvas: HTMLCanvasElement, doc: CampaignDocument, assets: CampaignAssets, options: FrameOptions) {
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Brauser ei saanud kujundust avada.')
  const portrait = options.format !== 'post', height = portrait ? 1920 : 1350
  const time = options.time ?? 1, animated = options.format === 'reel'
  const index = animated ? Math.max(0, Math.min(2, Math.floor(time / 3))) : options.index ?? 0
  const variant = (doc.variation + (animated ? 0 : index)) % 3
  const dark = doc.template === 'message'
  ctx.save(); ctx.scale(canvas.width / 1080, canvas.height / height)
  ctx.fillStyle = dark ? colors.ink : variant === 1 ? '#edf0e3' : colors.cream
  ctx.fillRect(0, 0, 1080, height)
  ctx.fillStyle = dark ? '#293f2e' : colors.sage
  ctx.beginPath(); ctx.ellipse(800 + Math.sin(time * .4) * 30, height * .56, 660, height * .39, -.3, 0, Math.PI * 2); ctx.fill()
  const end = animated ? Math.max(0, Math.min(1, (time - (contentDuration(doc) - .3)) / .65)) : 0
  const drawScene = (scene: SceneKey, opacity: number) => {
    if (opacity <= 0) return
    for (const element of sceneElements(doc, scene)) {
      if (!element.visible || (element.text !== undefined && !element.text.trim())) continue
      ctx.save(); ctx.globalAlpha = opacity
      ctx.translate(element.x, element.y); ctx.rotate(element.rotation * Math.PI / 180); ctx.scale(element.scale, element.scale)
      ctx.translate(-540, -element.height / 2)
      const isEnd = scene === 'reelEnd'
      if (element.id === 'phone') phone(ctx, assets.images, doc.media, index, element.height / 2, element.width, time, animated, options.phoneFrame)
      else if (element.imageIndex !== undefined) {
        const i = animated ? (element.imageIndex + index) % 3 : element.imageIndex
        photo(ctx, assets.images[i], doc.media[i], 540, element.height / 2, element.width - 24, element.height - 24)
      } else if (element.id === 'logo') brand(ctx, assets.mark, 0, element.height, dark)
      else {
        const cta = element.id === 'cta'
        const serif = element.id === 'slogan'
        const lightText = dark && !cta
        const color = cta ? dark ? colors.ink : colors.cream : lightText ? colors.cream : serif || element.id === 'support' || !isEnd ? colors.green : colors.ink
        if (cta) rounded(ctx, 540 - element.width / 2, 0, element.width, element.height, element.height / 2, dark ? colors.lime : colors.green)
        textBlock(ctx, element.text ?? '', 0, { size: element.size, width: element.width - (cta ? 40 : 0), maxLines: element.maxLines ?? 1, color, serif,
          weight: serif || element.id === 'support' ? 500 : element.id === 'url' ? 600 : 800, boxHeight: element.height })
      }
      ctx.restore()
    }
  }
  drawScene(sceneKey(options.format, index), 1 - end)
  if (animated) drawScene('reelEnd', end)
  ctx.restore()
}

export function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Pildi loomine ebaõnnestus.')), 'image/jpeg', .93))
}
export async function prepareCampaignImage(file: File): Promise<CampaignMedia> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15_000_000) throw new Error('Vali kuni 15 MB JPG-, PNG- või WebP-pilt.')
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const canvas = document.createElement('canvas'), scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = colors.cream; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    let quality = .86, src = canvas.toDataURL('image/jpeg', quality)
    while (src.length >= 1_200_000 && quality > .4) { quality -= .1; src = canvas.toDataURL('image/jpeg', quality) }
    if (src.length >= 1_200_000) throw new Error('Pilt on liiga detailne. Vali väiksem pilt.')
    return { src, kind: 'photo', alt: file.name.replace(/\.[^.]+$/, '').slice(0, 200) }
  } finally { bitmap.close() }
}
