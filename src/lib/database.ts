import type { Product, ProductImageAsset } from '../products'
import { requireSupabase } from './supabase'

export const DEMO_STORE_ID = '00000000-0000-4000-8000-000000000001'

export type StoreRecord = {
  id: string
  owner_id: string | null
  name: string
  slug: string
  is_published: boolean
  payment_provider: 'stripe' | 'montonio'
  payment_status: 'idle' | 'connected' | 'pending'
  stripe_account_id: string | null
  stripe_account_charges_enabled: boolean
  stripe_account_payouts_enabled: boolean
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_subscription_status: string | null
  pricing_plan: 'flexible' | 'fixed'
  trial_started_at: string | null
  shipping: string[]
  settings: Record<string, unknown>
}

export type CustomDomainRecord = {
  id: string
  storeId: string
  hostname: string
  status: 'pending_dns' | 'verifying' | 'active' | 'error'
  verificationStatus: 'verified' | 'unverified' | null
  domainType: 'apex' | 'subdomain' | null
  dnsRecord: { type: string; name: string; value: string } | null
  error: string | null
  dnsVerifiedAt: string | null
  tlsVerifiedAt: string | null
  lastCheckedAt: string | null
}

export type OrderRecord = {
  id: string
  store_id: string
  order_number: string
  items: unknown[]
  customer_name: string
  customer_email: string
  delivery: string
  product_subtotal: number
  total: number
  status: 'new' | 'fulfilled' | 'refunded'
  created_at: string
  stripe_processing_fee_cents: number
  stripe_platform_fee_cents: number
  stripe_seller_net_cents: number
}

const throwIfError = (error: { message: string } | null) => {
  if (error) throw new Error(error.message)
}

// crypto.randomUUID is unavailable in older Safari versions and on non-secure
// LAN origins (http://192.168... / http://172.16...). getRandomValues remains
// available there, so image uploads still get collision-resistant names.
const createRandomId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  if (bytes.some(Boolean)) return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export async function getMyStore() {
  const client = requireSupabase()
  const { data: userData, error: userError } = await client.auth.getUser()
  throwIfError(userError)
  if (!userData.user) return null
  const { data, error } = await client
    .from('stores')
    .select('*')
    .eq('owner_id', userData.user.id)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  throwIfError(error)
  return data as StoreRecord | null
}

export async function getStoreBySlug(slug: string) {
  const { data, error } = await requireSupabase().from('stores').select('*').eq('slug', slug).eq('is_published', true).maybeSingle()
  throwIfError(error)
  return data as StoreRecord | null
}

export async function getStoreByHostname(hostname: string) {
  const { data: slug, error: resolveError } = await requireSupabase()
    .rpc('resolve_store_slug_for_hostname', { requested_hostname: hostname })
  throwIfError(resolveError)
  return slug ? getStoreBySlug(String(slug)) : null
}

export async function getDemoStore() {
  const { data, error } = await requireSupabase().from('stores').select('*').eq('id', DEMO_STORE_ID).maybeSingle()
  throwIfError(error)
  return data as StoreRecord | null
}

export async function createStore(input: Pick<StoreRecord, 'name' | 'slug' | 'payment_provider' | 'payment_status' | 'pricing_plan' | 'trial_started_at' | 'shipping'> & Partial<Pick<StoreRecord, 'is_published' | 'settings'>>) {
  const { data: userData, error: userError } = await requireSupabase().auth.getUser()
  throwIfError(userError)
  if (!userData.user) throw new Error('Poe loomiseks logi sisse.')
  const { data, error } = await requireSupabase().from('stores').insert({ ...input, owner_id: userData.user.id }).select().single()
  throwIfError(error)
  return data as StoreRecord
}

export async function updateStore(storeId: string, input: Partial<Omit<StoreRecord, 'id' | 'owner_id'>>) {
  const { data, error } = await requireSupabase().from('stores').update(input).eq('id', storeId).select().single()
  throwIfError(error)
  return data as StoreRecord
}

export async function invokeStripeConnect(action: 'start' | 'status') {
  const { data, error } = await requireSupabase().functions.invoke('stripe-connect', { body: { action } })
  if (error) {
    const context = 'context' in error ? error.context : null
    const details = context instanceof Response
      ? await context.clone().json().catch(() => null) as { error?: string } | null
      : null
    throw new Error(details?.error || error.message)
  }
  if (data?.error) throw new Error(String(data.error))
  return data as { clientSecret?: string; status?: StoreRecord['payment_status']; chargesEnabled?: boolean; payoutsEnabled?: boolean }
}

export async function manageCustomDomain(
  action: 'create' | 'status' | 'verify' | 'delete',
  storeId: string,
  hostname?: string,
) {
  const { data, error } = await requireSupabase().functions.invoke('custom-domain', {
    body: { action, storeId, hostname },
  })
  if (error) {
    const context = 'context' in error ? error.context : null
    const details = context instanceof Response
      ? await context.clone().json().catch(() => null) as { error?: string } | null
      : null
    throw new Error(details?.error || error.message)
  }
  if (data?.error) throw new Error(String(data.error))
  return (data?.domain ?? null) as CustomDomainRecord | null
}

const invokeCheckoutFunction = async (name: string, body?: Record<string, unknown>) => {
  const { data, error } = await requireSupabase().functions.invoke(name, { body: body ?? {} })
  if (error) {
    const context = 'context' in error ? error.context : null
    const details = context instanceof Response
      ? await context.clone().json().catch(() => null) as { error?: string } | null
      : null
    throw new Error(details?.error || error.message)
  }
  if (data?.error) throw new Error(String(data.error))
  if (!data?.url) throw new Error('Makselehe aadress puudub.')
  return String(data.url)
}

export async function startStripeStoreCheckout(input: {
  storeId: string
  items: Array<{ id: string; quantity: number; selectedOptions: Record<string, string> }>
  customer: { name: string; email: string; phone: string }
  delivery: { type: 'parcel' | 'courier' | 'pickup'; provider?: 'omniva' | 'dpd' | 'smartposti'; label: string }
  checkoutRequestId: string
}) {
  return invokeCheckoutFunction('stripe-store-checkout', { ...input, returnUrl: window.location.origin })
}

export async function startStripeBillingCheckout(checkoutRequestId: string) {
  return invokeCheckoutFunction('stripe-billing-checkout', { checkoutRequestId, returnUrl: window.location.origin })
}

export async function refundStripeOrder(storeId: string, orderNumber: string) {
  const { data, error } = await requireSupabase().functions.invoke('stripe-refund-order', { body: { storeId, orderNumber } })
  if (error) {
    const context = 'context' in error ? error.context : null
    const details = context instanceof Response
      ? await context.clone().json().catch(() => null) as { error?: string } | null
      : null
    throw new Error(details?.error || error.message)
  }
  if (data?.error) throw new Error(String(data.error))
}

export async function cancelStripeBilling() {
  const { data, error } = await requireSupabase().functions.invoke('stripe-billing-cancel', { body: {} })
  if (error) {
    const context = 'context' in error ? error.context : null
    const details = context instanceof Response
      ? await context.clone().json().catch(() => null) as { error?: string } | null
      : null
    throw new Error(details?.error || error.message)
  }
  if (data?.error) throw new Error(String(data.error))
  return data as { effectiveImmediately: boolean; cancelAt?: string | null }
}

export async function listProducts(storeId: string) {
  const { data, error } = await requireSupabase().from('products').select('*').eq('store_id', storeId).order('sort_order').order('created_at')
  throwIfError(error)
  return (data ?? []).map(productFromRow)
}

const productFromRow = (row: Record<string, unknown>): Product => ({
  id: String(row.id), name: String(row.name), image: String(row.image_url), gallery: row.gallery as string[] | undefined,
  alt: String(row.alt ?? row.name), description: row.description as string | undefined,
  price: row.price == null ? undefined : Number(row.price), salePrice: row.sale_price == null ? undefined : Number(row.sale_price),
  objectPosition: row.object_position as string | undefined, slug: row.slug as string | undefined,
  imageTransforms: row.image_transforms as Product['imageTransforms'],
  imageVariants: row.image_variants as Product['imageVariants'],
  seoTitle: row.seo_title as string | undefined, searchVisible: Boolean(row.search_visible),
  stock: row.stock == null ? undefined : Number(row.stock), oneOfAKind: Boolean(row.one_of_a_kind),
  options: row.options as Product['options'],
})

const productToRow = (storeId: string, product: Product) => ({
  id: product.id, store_id: storeId, name: product.name, image_url: product.image, gallery: product.gallery ?? [product.image],
  alt: product.alt, description: product.description ?? '', price: product.price ?? null, sale_price: product.salePrice ?? null,
  object_position: product.objectPosition ?? null, slug: product.slug ?? null, seo_title: product.seoTitle ?? null,
  image_transforms: product.imageTransforms ?? {},
  image_variants: product.imageVariants ?? {},
  search_visible: product.searchVisible ?? true, stock: product.stock ?? null, one_of_a_kind: product.oneOfAKind ?? false,
  options: product.options ?? [],
})

export async function saveProduct(storeId: string, product: Product) {
  const { data, error } = await requireSupabase().from('products').upsert(productToRow(storeId, product)).select().single()
  if (error?.message.toLowerCase().includes('row-level security')) {
    throw new Error('Sul puudub selle poe muutmise õigus. Logi uuesti sisse ja proovi uuesti.')
  }
  throwIfError(error)
  return productFromRow(data as Record<string, unknown>)
}

export async function removeProduct(productId: string) {
  const { error } = await requireSupabase().from('products').delete().eq('id', productId)
  throwIfError(error)
}

const getProductImageStoragePath = (url: string) => {
  try {
    const marker = '/storage/v1/object/public/product-images/'
    const pathname = new URL(url).pathname
    const markerIndex = pathname.indexOf(marker)
    return markerIndex === -1 ? null : decodeURIComponent(pathname.slice(markerIndex + marker.length))
  } catch { return null }
}

export async function removeStoredProductImages(imageVariants: Product['imageVariants'], imageUrls: string[]) {
  const urls = new Set<string>()
  imageUrls.forEach((url) => {
    urls.add(url)
    const asset = imageVariants?.[url]
    if (asset) Object.values(asset.variants).forEach((variant) => urls.add(variant.url))
  })
  const paths = [...urls].map(getProductImageStoragePath).filter((path): path is string => Boolean(path))
  if (!paths.length) return
  const { error } = await requireSupabase().storage.from('product-images').remove([...new Set(paths)])
  throwIfError(error)
}

export type ImageUploadPhase = 'preparing' | 'uploading'

type DecodedImage = { source: CanvasImageSource; width: number; height: number; dispose: () => void }

const decodeImage = async (file: File): Promise<DecodedImage> => {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() }
  } catch {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.src = objectUrl
    try {
      await image.decode()
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(objectUrl) }
    } catch {
      URL.revokeObjectURL(objectUrl)
      throw new Error('Seda pildivormingut ei õnnestunud töödelda. Salvesta pilt JPG-, PNG- või WebP-vormingus.')
    }
  }
}

const encodeImage = async (decoded: DecodedImage, maximumSide: number, quality: number) => {
  const ratio = Math.min(1, maximumSide / Math.max(decoded.width, decoded.height))
  const width = Math.max(1, Math.round(decoded.width * ratio))
  const height = Math.max(1, Math.round(decoded.height * ratio))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('Brauser ei saanud pilti töödelda.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(decoded.source, 0, 0, width, height)
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
  if (!blob || blob.type !== 'image/webp') blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Pildi optimeerimine ebaõnnestus.')
  return { blob, width, height }
}

const uploadPublicImage = async (storeId: string, relativePath: string, blob: Blob) => {
  const client = requireSupabase()
  const path = `${storeId}/${relativePath}`
  const { error } = await client.storage.from('product-images').upload(path, blob, {
    contentType: blob.type,
    cacheControl: '31536000',
    upsert: false,
  })
  throwIfError(error)
  return { path, url: client.storage.from('product-images').getPublicUrl(path).data.publicUrl }
}

export type UploadedProductImage = { url: string; asset: ProductImageAsset }

export async function uploadProductImages(storeId: string, files: File[], onPhase?: (index: number, phase: ImageUploadPhase) => void) {
  const results: UploadedProductImage[] = []
  for (const [index, file] of files.entries()) {
    if (file.size > 40_000_000) throw new Error('Pilt on töötlemiseks liiga suur. Maksimaalne algfail on 40 MB.')
    onPhase?.(index, 'preparing')
    const decoded = await decodeImage(file)
    if (decoded.width * decoded.height > 80_000_000) {
      decoded.dispose()
      throw new Error('Pildi mõõtmed on liiga suured. Vali kuni 80-megapiksline foto.')
    }
    const imageId = createRandomId()
    const specs = [
      ['master', 2400, .84],
      ['large', 1600, .82],
      ['medium', 960, .8],
      ['thumb', 480, .78],
    ] as const
    const encodedBySize = new Map<string, { blob: Blob; width: number; height: number; role: string }>()
    const encodedByRole = new Map<string, { blob: Blob; width: number; height: number; role: string }>()
    try {
      for (const [role, maximumSide, quality] of specs) {
        const width = Math.max(1, Math.round(decoded.width * Math.min(1, maximumSide / Math.max(decoded.width, decoded.height))))
        const height = Math.max(1, Math.round(decoded.height * Math.min(1, maximumSide / Math.max(decoded.width, decoded.height))))
        const sizeKey = `${width}x${height}`
        const existing = encodedBySize.get(sizeKey)
        const encoded = existing ?? { ...(await encodeImage(decoded, maximumSide, quality)), role }
        if (!existing) encodedBySize.set(sizeKey, encoded)
        encodedByRole.set(role, encoded)
      }
    } finally {
      decoded.dispose()
    }
    onPhase?.(index, 'uploading')
    const uploadedBySize = new Map<string, { url: string; width: number; height: number; bytes: number }>()
    const uploadedPaths: string[] = []
    try {
      for (const encoded of encodedBySize.values()) {
        const extension = encoded.blob.type === 'image/webp' ? 'webp' : 'png'
        const uploaded = await uploadPublicImage(storeId, `${imageId}/${encoded.role}.${extension}`, encoded.blob)
        uploadedPaths.push(uploaded.path)
        uploadedBySize.set(`${encoded.width}x${encoded.height}`, { url: uploaded.url, width: encoded.width, height: encoded.height, bytes: encoded.blob.size })
      }
    } catch (error) {
      if (uploadedPaths.length) await requireSupabase().storage.from('product-images').remove(uploadedPaths)
      throw error
    }
    const getVariant = (role: string) => {
      const encoded = encodedByRole.get(role)!
      return uploadedBySize.get(`${encoded.width}x${encoded.height}`)!
    }
    const asset: ProductImageAsset = {
      mimeType: encodedByRole.get('master')!.blob.type,
      variants: { thumb: getVariant('thumb'), medium: getVariant('medium'), large: getVariant('large'), master: getVariant('master') },
    }
    results.push({ url: asset.variants.master.url, asset })
  }
  return results
}

export async function uploadImages(storeId: string, files: File[], onPhase?: (index: number, phase: ImageUploadPhase) => void) {
  const results: string[] = []
  for (const [index, originalFile] of files.entries()) {
    if (originalFile.size > 40_000_000) throw new Error('Pilt on töötlemiseks liiga suur. Maksimaalne algfail on 40 MB.')
    onPhase?.(index, 'preparing')
    const decoded = await decodeImage(originalFile)
    if (decoded.width * decoded.height > 80_000_000) {
      decoded.dispose()
      throw new Error('Pildi mõõtmed on liiga suured. Vali kuni 80-megapiksline foto.')
    }
    let encoded: Awaited<ReturnType<typeof encodeImage>>
    try { encoded = await encodeImage(decoded, 2000, .84) } finally { decoded.dispose() }
    onPhase?.(index, 'uploading')
    const extension = encoded.blob.type === 'image/webp' ? 'webp' : 'png'
    const uploaded = await uploadPublicImage(storeId, `assets/${createRandomId()}.${extension}`, encoded.blob)
    results.push(uploaded.url)
  }
  return results
}

export async function listOrders(storeId: string) {
  const { data, error } = await requireSupabase().from('orders').select('*').eq('store_id', storeId).in('payment_status', ['unpaid', 'paid', 'refunded']).order('created_at', { ascending: false })
  throwIfError(error)
  return (data ?? []) as OrderRecord[]
}

export async function createOrder(storeId: string, order: { id: string; items: unknown[]; customerName: string; customerEmail: string; delivery: string; productSubtotal: number; total: number }) {
  const { error } = await requireSupabase().from('orders').insert({
    store_id: storeId, order_number: order.id, items: order.items, customer_name: order.customerName,
    customer_email: order.customerEmail, delivery: order.delivery, product_subtotal: order.productSubtotal, total: order.total,
  })
  throwIfError(error)
}

export async function updateOrderStatus(storeId: string, orderNumber: string, status: OrderRecord['status']) {
  const { error } = await requireSupabase().from('orders').update({ status }).eq('store_id', storeId).eq('order_number', orderNumber)
  throwIfError(error)
}
