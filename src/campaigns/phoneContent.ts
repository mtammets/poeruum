import type { Product } from '../products'
import type { PublicStoreRecord } from '../lib/database'
import type { CampaignDocument } from './model'

export const actionLabels = { product: 'Näita toodet', scroll: 'Keri tooteinfot', swipe: 'Vaheta toodet', gallery: 'Vaheta galeriipilti', search: 'Otsi toodet' } as const
export type PhoneAction = { type: keyof typeof actionLabels; productId: string; duration: number; imageIndex?: number; query?: string }
export type PhoneSnapshot = {
  id: string; capturedAt: string
  store: { id: string; name: string; slug: string; sellerDetailsComplete?: boolean; settings: Record<string, unknown> }
  products: Product[]; assets: Record<string, string>
}
export type PhoneContent = { snapshot: PhoneSnapshot; actions: PhoneAction[] }
export const MAX_CONTENT_SECONDS = 27
export const MAX_PRODUCTS = 6
export const settingKeys = ['storeTheme', 'storeAccent', 'buyButtonSize', 'saleBadgeStyle', 'announcementEnabled', 'announcementText', 'announcementSpeed', 'announcementDirection', 'announcementBackground', 'announcementColor', 'editableStoreName', 'storeDescription', 'storeLogo'] as const
export const contentDuration = (doc: CampaignDocument) => doc.template === 'phone' && doc.phoneContent ? doc.phoneContent.actions.reduce((sum, action) => sum + action.duration, 0) : 9
export const campaignDuration = (doc: CampaignDocument) => contentDuration(doc) + 3
export function actionTimeline(actions: PhoneAction[]) {
  let start = 0
  return actions.map((action) => { const scene = { ...action, start, end: start + action.duration }; start = scene.end; return scene })
}
export function presetActions(products: Product[], preset = 'browse'): PhoneAction[] {
  const first = products[0], next = products[1] ?? first
  if (!first) return []
  if (preset === 'search') {
    const target = products.find((p) => p.searchVisible !== false) ?? first
    return [{ type: 'product', productId: first.id, duration: 2 }, { type: 'search', productId: target.id, duration: 5, query: target.name.slice(0, 40) }, { type: 'scroll', productId: target.id, duration: 2 }]
  }
  if (preset === 'products') return products.slice(0, 3).map((p, i, list) => ({ type: i ? 'swipe' : 'product', productId: p.id, duration: 9 / list.length }))
  return [{ type: 'product', productId: first.id, duration: 2 }, { type: 'scroll', productId: first.id, duration: 3 }, { type: 'swipe', productId: next.id, duration: 2 },
    { type: (next.gallery?.length ?? 0) > 1 ? 'gallery' : 'product', productId: next.id, duration: 2, ...((next.gallery?.length ?? 0) > 1 ? { imageIndex: 1 } : {}) }]
}
export function materializeSnapshot(snapshot: PhoneSnapshot) {
  const resolve = (key: string) => snapshot.assets[key]
  return {
    store: { ...snapshot.store, is_published: true, payment_provider: 'stripe', payment_status: 'connected', shipping: [], settings: { ...snapshot.store.settings, storeLogo: snapshot.store.settings.storeLogo ? resolve(String(snapshot.store.settings.storeLogo)) : null } } as PublicStoreRecord,
    products: snapshot.products.map((p) => ({ ...p, image: resolve(p.image), gallery: p.gallery?.map(resolve), imageTransforms: Object.fromEntries(Object.entries(p.imageTransforms ?? {}).map(([key, value]) => [resolve(key), value])) })),
  }
}
export function productMedia(snapshot: PhoneSnapshot) {
  return [0, 1, 2].map((i) => { const p = snapshot.products[i % snapshot.products.length]; return { src: `campaign-product:${p.id}`, alt: p.name.slice(0, 200), kind: 'photo' as const } })
}
export function mediaSource(doc: CampaignDocument, src: string) {
  if (!src.startsWith('campaign-product:')) return src
  const snapshot = doc.phoneContent?.snapshot, product = snapshot?.products.find((p) => p.id === src.slice(17))
  return product && snapshot ? snapshot.assets[product.image] : ''
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const string = (v: unknown, max: number) => typeof v === 'string' && v.length <= max
const identity = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v)
const normalizeSearch = (v: string) => v.toLocaleLowerCase('et').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
export function parsePhoneContent(value: unknown, allowIncomplete = false): PhoneContent | null {
  if (!record(value) || !record(value.snapshot)) return null
  const { snapshot: s, actions } = value
  if (!identity(s.id) || !string(s.capturedAt, 40) || !Number.isFinite(Date.parse(s.capturedAt)) || !record(s.store) || !identity(s.store.id) || !string(s.store.name, 200) || !s.store.name.trim() || !identity(s.store.slug) || (s.store.sellerDetailsComplete !== undefined && typeof s.store.sellerDetailsComplete !== 'boolean') || !record(s.store.settings) || !record(s.assets)) return null
  if (Object.keys(s.assets).length > 25 || !Object.entries(s.assets).every(([key, value]) => /^asset:\d{1,2}$/.test(key) && string(value, 150_000) && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value as string))) return null
  const settings: Record<string, unknown> = {}
  for (const key of settingKeys) if (s.store.settings[key] !== undefined) {
    const value = s.store.settings[key]
    if (key === 'storeLogo' ? !Object.hasOwn(s.assets, value) : key === 'announcementEnabled' ? typeof value !== 'boolean' : !string(value, key === 'storeDescription' ? 3000 : 500)) return null
    settings[key] = value
  }
  const hasAsset = (key: unknown): key is string => typeof key === 'string' && Object.hasOwn(s.assets, key)
  if (!Array.isArray(s.products) || !s.products.length || s.products.length > MAX_PRODUCTS) return null
  const products: Product[] = []
  for (const p of s.products) {
    if (!record(p) || !identity(p.id) || !string(p.name, 200) || !p.name.trim() || !string(p.alt, 200) || !hasAsset(p.image) || !Array.isArray(p.gallery) || !p.gallery.length || p.gallery.length > 4 || !p.gallery.every(hasAsset)
      || (p.description !== undefined && !string(p.description, 5000)) || (p.price !== undefined && !finite(p.price, 0, 1e9)) || (p.salePrice !== undefined && !finite(p.salePrice, 0, 1e9))
      || (p.stock !== undefined && !finite(p.stock, 0, 1e9)) || (p.objectPosition !== undefined && !string(p.objectPosition, 40))
      || (p.oneOfAKind !== undefined && typeof p.oneOfAKind !== 'boolean') || (p.searchVisible !== undefined && typeof p.searchVisible !== 'boolean')) return null
    if (p.options !== undefined && (!Array.isArray(p.options) || p.options.length > 10 || !p.options.every((o: unknown) => record(o) && string(o.name, 100) && Array.isArray(o.values) && o.values.length <= 50 && o.values.every((v: unknown) => string(v, 100))))) return null
    if (p.imageTransforms !== undefined && (!record(p.imageTransforms) || !Object.entries(p.imageTransforms).every(([key, v]) => hasAsset(key) && record(v) && finite(v.x, -100, 100) && finite(v.y, -100, 100) && finite(v.scale, .1, 10)))) return null
    products.push({ id: p.id, name: p.name, alt: p.alt, image: p.image, gallery: p.gallery, description: p.description, price: p.price, salePrice: p.salePrice, stock: p.stock, oneOfAKind: p.oneOfAKind, searchVisible: p.searchVisible, objectPosition: p.objectPosition, options: p.options, imageTransforms: p.imageTransforms })
  }
  if (new Set(products.map((p) => p.id)).size !== products.length || !Array.isArray(actions) || !actions.length || actions.length > 8) return null
  const parsed: PhoneAction[] = []
  for (const a of actions) {
    if (!record(a) || !Object.hasOwn(actionLabels, a.type) || !finite(a.duration, 1, 10) || Math.round(a.duration * 10) !== a.duration * 10) return null
    const product = products.find((p) => p.id === a.productId)
    if (!product || (a.type === 'gallery' && (!Number.isInteger(a.imageIndex) || a.imageIndex < 0 || a.imageIndex >= product.gallery!.length))
      || (a.type === 'search' && (!string(a.query, 40) || (!allowIncomplete && (!a.query.trim() || product.searchVisible === false || !normalizeSearch(`${product.name} ${product.description ?? ''}`).includes(normalizeSearch(a.query).trim())))))) return null
    parsed.push({ type: a.type, duration: a.duration, productId: a.productId, ...(a.type === 'gallery' ? { imageIndex: a.imageIndex } : {}), ...(a.type === 'search' ? { query: a.query } : {}) })
  }
  if (!allowIncomplete && parsed.reduce((sum, a) => sum + a.duration, 0) > MAX_CONTENT_SECONDS) return null
  const snapshot: PhoneSnapshot = { id: s.id, capturedAt: s.capturedAt, store: { id: s.store.id, name: s.store.name, slug: s.store.slug, sellerDetailsComplete: s.store.sellerDetailsComplete, settings }, products, assets: s.assets }
  if (JSON.stringify(snapshot).length > 2_600_000) return null
  return { snapshot, actions: parsed }
}
