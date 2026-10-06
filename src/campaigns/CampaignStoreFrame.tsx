import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { toSvg } from 'html-to-image'
import { Storefront } from '../App'
import type { StorefrontPreviewData } from '../HomepageStorePhone'
import type { StoreCapture } from './captureTypes'
import '../platform.css'

const data = JSON.parse(document.getElementById('storefront-preview-data')?.textContent || 'null') as StorefrontPreviewData & { store: { sellerDetailsComplete?: boolean } }
let fontData: Promise<string> | undefined
function embeddedFont() {
  return fontData ??= fetch('/campaigns/manrope.woff2').then((r) => r.blob()).then((blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob)
  }))
}
async function rasterize(xml: Document, height: number) {
  xml.documentElement.setAttribute('height', String(height))
  xml.documentElement.setAttribute('viewBox', `0 0 390 ${height}`)
  const image = new Image()
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(xml))
  await image.decode()
  const canvas = document.createElement('canvas'); canvas.width = 780; canvas.height = height * 2
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas
}

function carouselLayer(xml: Document, overlay: boolean) {
  const layer = xml.cloneNode(true) as Document
  const root = layer.querySelector<HTMLElement>('.app-shell')!, stage = layer.querySelector<HTMLElement>('.story-stage')!
  // Preserve computed geometry while separating the moving full-height photo
  // from the stationary progress, header, gallery and buy controls.
  for (const child of [...root.children]) if (child !== stage && !child.matches('style')) child.remove()
  for (const child of [...stage.children]) if (!child.matches('style') && child.matches('.story-track') === overlay) child.remove()
  root.style.background = 'transparent'
  stage.style.background = 'transparent'
  return rasterize(layer, 804)
}

export default function CampaignStoreFrame() {
  const [state, setState] = useState({ productId: data.products[0].id, imageIndex: 0, search: null as { query: string; selectedProductId?: string } | null })
  const [ready, setReady] = useState(false)
  useEffect(() => {
    document.documentElement.classList.add('app-ready')
    if (!ready) return
    window.campaignCapture = async (next) => {
      flushSync(() => setState(next))
      // Let the real carousel finish its index normalization before cloning it.
      await new Promise((resolve) => setTimeout(resolve, 260))
      window.scrollTo(0, 0)
      await document.fonts.ready
      await Promise.all([...document.images].filter((img) => img.loading !== 'lazy').map((img) => img.decode()))
      const root = document.querySelector<HTMLElement>('.app-shell')!, track = document.querySelector<HTMLElement>('.story-track')!
      const height = next.search ? 804 : Math.min(2400, Math.max(804, root.scrollHeight))
      const svg = await toSvg(root, { width: 390, height, fontEmbedCSS: `@font-face{font-family:Manrope;src:url(${await embeddedFont()});font-weight:200 800}`, filter: (node) => {
        // Keep slide geometry, but only clone the visible slide's contents.
        const slide = node.parentElement?.closest<HTMLElement>('.story-slide')
        return !slide || Math.abs(slide.offsetLeft - track.scrollLeft) < 10
      } })
      const xml = new DOMParser().parseFromString(decodeURIComponent(svg.slice(svg.indexOf(',') + 1)), 'image/svg+xml')
      xml.querySelectorAll<HTMLElement>('.story-slide').forEach((slide) => { slide.style.transform = `translateX(${-track.scrollLeft}px)` })
      const capture: StoreCapture = { page: await rasterize(xml, height) }
      if (!next.search) {
        const [image, overlay] = await Promise.all([carouselLayer(xml, false), carouselLayer(xml, true)])
        capture.carousel = { image, overlay }
      }
      return capture
    }
    return () => { delete window.campaignCapture }
  }, [ready])
  return <Storefront storeId={data.store.id} storeName={data.store.name} storeSlug={data.store.slug}
    seedProducts={data.products} initialSettings={data.store.settings} initialShipping={data.store.shipping}
    embeddedPreview previewSellerDetailsComplete={data.store.sellerDetailsComplete} initialProductSlug={state.productId} previewImageSelection={{ productId: state.productId, index: state.imageIndex }}
    previewSearch={state.search} onInitialVisualReady={() => setReady(true)} />
}
