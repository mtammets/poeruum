import { hasSellerDetails } from '../../shared/seller'
import type { PublicStoreRecord } from '../lib/database'
import type { Product } from '../products'
import { createRandomId } from '../lib/randomId'
import { MAX_PRODUCTS, settingKeys, type PhoneSnapshot } from './phoneContent'

// Embed image bytes once, so saved campaigns do not depend on mutable store URLs.
export async function captureStoreSnapshot(store: PublicStoreRecord, products: Product[], signal: AbortSignal): Promise<PhoneSnapshot> {
  if (!products.length || products.length > MAX_PRODUCTS) throw new Error('Vali 1–6 toodet.')
  const assets: Record<string, string> = {}, known = new Map<string, string>()
  async function embed(url: string, logo = false) {
    if (known.has(url)) return known.get(url)!
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error('Poe pilti ei saanud laadida. Proovi uuesti.')
    const blob = await response.blob()
    if (blob.size > 20_000_000) throw new Error('Poe pilt on liiga suur.')
    const objectUrl = URL.createObjectURL(blob), image = new Image()
    try {
      image.src = objectUrl; await image.decode(); signal.throwIfAborted()
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!
      let size = logo ? 160 : 1000, encoded = ''
      for (let attempt = 0; attempt < 6; attempt++) {
        const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight))
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
        if (!logo) { ctx.fillStyle = '#f4f2e9'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        encoded = canvas.toDataURL(logo ? 'image/png' : 'image/jpeg', .84 - attempt * .065)
        if (encoded.length < (logo ? 35_000 : 100_000)) break
        size *= .84
      }
      if (encoded.length > 150_000) throw new Error('Poe pildi salvestamine ebaõnnestus.')
      const key = `asset:${Object.keys(assets).length}`; assets[key] = encoded; known.set(url, key); return key
    } finally { URL.revokeObjectURL(objectUrl) }
  }
  // Database nullable columns can arrive as null despite optional TS fields.
  // Normalize empty values before applying the strict saved-document schema.
  const copied: Product[] = []
  for (const p of products) {
    const urls = [...new Set([p.image, ...(p.gallery ?? [])])].slice(0, 4), gallery: string[] = [], transforms: Product['imageTransforms'] = {}
    for (const url of urls) { const key = await embed(url); gallery.push(key); if (p.imageTransforms?.[url]) transforms[key] = p.imageTransforms[url] }
    copied.push({ id: p.id, name: p.name.slice(0, 200), alt: p.alt.slice(0, 200), image: gallery[0], gallery, description: p.description?.slice(0, 5000), price: p.price, salePrice: p.salePrice, stock: p.stock, oneOfAKind: p.oneOfAKind, searchVisible: p.searchVisible, objectPosition: p.objectPosition ?? undefined, options: p.options ?? undefined, imageTransforms: transforms })
  }
  const settings: Record<string, unknown> = {}
  for (const key of settingKeys) {
    const value = store.settings[key]
    if (key === 'storeLogo') { if (typeof value === 'string' && value) settings[key] = await embed(value, true) }
    else if (typeof value === 'string') settings[key] = value.slice(0, key === 'storeDescription' ? 3000 : 500)
    else if (typeof value === 'boolean') settings[key] = value
  }
  return { id: createRandomId(), capturedAt: new Date().toISOString(), store: { id: store.id, name: store.name, slug: store.slug, sellerDetailsComplete: store.settings.isDemoStore === true || hasSellerDetails(store.settings), settings }, products: copied, assets }
}
