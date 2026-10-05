import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { toSvg } from 'html-to-image'
import { Storefront } from '../App'
import type { StorefrontPreviewData } from '../HomepageStorePhone'
import './captureTypes'
import '../platform.css'

const data = JSON.parse(document.getElementById('storefront-preview-data')?.textContent || 'null') as StorefrontPreviewData & { store: { sellerDetailsComplete?: boolean } }
let fontData: Promise<string> | undefined
function embeddedFont() {
  return fontData ??= fetch('/campaigns/manrope.woff2').then((r) => r.blob()).then((blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob)
  }))
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
      const image = new Image()
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(xml))
      await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = 780; canvas.height = height * 2
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      return canvas
    }
    return () => { delete window.campaignCapture }
  }, [ready])
  return <Storefront storeId={data.store.id} storeName={data.store.name} storeSlug={data.store.slug}
    seedProducts={data.products} initialSettings={data.store.settings} initialShipping={data.store.shipping}
    embeddedPreview previewSellerDetailsComplete={data.store.sellerDetailsComplete} initialProductSlug={state.productId} previewImageSelection={{ productId: state.productId, index: state.imageIndex }}
    previewSearch={state.search} onInitialVisualReady={() => setReady(true)} />
}
