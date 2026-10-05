// Capture the real homepage storefront UI; no recreated shop controls or text.
// Usage: node scripts/capture-campaign-phone.mjs path/to/store-data.json [origin]
// Input: { store: PublicStoreRecord, products: Product[] }. Requires ffmpeg + Vite.
/* global document, location, window, Image */
import { chromium } from '@playwright/test'
import { readFile, mkdir, rename } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const dataPath = process.argv[2]
if (!dataPath) throw new Error('Supply a public storefront snapshot JSON file.')
const origin = process.argv[3] || 'http://localhost:5173'
const data = JSON.parse(await readFile(dataPath, 'utf8'))
// Match the three existing campaign stills: oyster, espresso cup, plate.
const products = [data.products[3], data.products[0], data.products[2]]
if (products.some((product) => !product)) throw new Error('The campaign needs its three reference products.')
const browser = await chromium.launch()
let encoder
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 804 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.evaluate(({ store, products }) => {
    const scripts = [...document.querySelectorAll('script[type="module"]')]
      .filter((s) => s.src || s.textContent?.includes('/@react-refresh')).map((s) => s.outerHTML).join('')
    const styles = [...document.querySelectorAll('link[rel="stylesheet"]')].map((s) => s.outerHTML).join('')
    const payload = JSON.stringify({ store, products }).replace(/</g, '\\u003c')
    const frame = document.createElement('iframe')
    frame.id = 'capture'; frame.dataset.previewVisible = 'false'
    frame.style.cssText = 'position:fixed;inset:0;width:390px;height:804px;border:0'
    frame.srcdoc = `<!doctype html><html lang="et" data-storefront-preview="true" data-app-surface="storefront"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${location.origin}/">${styles}</head><body><div id="root"></div><script type="application/json" id="storefront-preview-data">${payload}</script>${scripts}</body></html>`
    document.body.replaceChildren(frame)
  }, { store: data.store, products })
  const frame = page.frames().find((f) => f.parentFrame())
  if (!frame) throw new Error('Preview frame did not open.')
  await frame.locator('.product-details').waitFor()
  await frame.evaluate(async (products) => {
    await document.fonts.ready
    await Promise.all([...document.images].map((image) => image.decode().catch(() => {})))
    await Promise.all(products.flatMap((product) => product.gallery || [product.image]).map(async (src) => {
      const image = new Image(); image.src = src; await image.decode()
    }))
    const track = document.querySelector('.story-track')
    track.style.scrollSnapType = 'none'
    track.style.scrollBehavior = 'auto'
    // The capture script supplies every intermediate scroll position. Prevent
    // the app's scroll-end snap from jumping ahead between captured frames.
    track.addEventListener('scrollend', (event) => event.stopImmediatePropagation(), true)
    const scrollTo = track.scrollTo.bind(track)
    track.scrollTo = (options) => { if (options.behavior !== 'smooth') scrollTo(options) }
  }, products)
  await page.waitForTimeout(500)
  await mkdir('output/campaign-phone', { recursive: true })
  encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', '30', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'output/campaign-phone/phone-demo.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] })
  const completion = once(encoder, 'close')
  for (let i = 0; i < 282; i++) {
    await frame.evaluate((time) => {
      const ease = (from, to) => { const p = Math.max(0, Math.min(1, (time - from) / (to - from))); return p * p * (3 - 2 * p) }
      const section = document.querySelector('.product-details')
      const detailTop = window.scrollY + section.getBoundingClientRect().top
      window.scrollTo({ top: detailTop * (ease(1.1, 2.1) - ease(3.2, 4.1)), behavior: 'instant' })
      const track = document.querySelector('.story-track')
      track.scrollTo({ left: track.clientWidth * (1 + ease(4.5, 5.3) + ease(6.3, 7.1)), behavior: 'instant' })
      if (time >= 7.9) document.querySelectorAll('.gallery-thumbnails button')[1]?.click()
    }, i / 30)
    const screenshot = await page.screenshot()
    if (!encoder.stdin.write(screenshot)) await once(encoder.stdin, 'drain')
    if ([0, 48, 78, 150, 201, 252].includes(i)) await page.screenshot({ path: `output/campaign-phone/frame-${i}.png` })
    if (i % 60 === 0) console.log(`Captured ${i}/282 frames`)
  }
  encoder.stdin.end()
  const [code] = await completion
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`)
  await rename('output/campaign-phone/phone-demo.mp4', 'public/campaigns/phone-demo.mp4')
  console.log('Created public/campaigns/phone-demo.mp4 (9.4 s, 780 × 1608, 30 fps).')
} finally { encoder?.kill(); await browser.close() }
