import type { Product } from '../products'
import { requireSupabase } from './supabase'

export type StoreRecord = {
  id: string
  owner_id: string
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
}) {
  return invokeCheckoutFunction('stripe-store-checkout', { ...input, returnUrl: window.location.origin })
}

export async function startStripeBillingCheckout() {
  return invokeCheckoutFunction('stripe-billing-checkout', { returnUrl: window.location.origin })
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
  seoTitle: row.seo_title as string | undefined, searchVisible: Boolean(row.search_visible),
  stock: row.stock == null ? undefined : Number(row.stock), oneOfAKind: Boolean(row.one_of_a_kind),
  options: row.options as Product['options'],
})

const productToRow = (storeId: string, product: Product) => ({
  id: product.id, store_id: storeId, name: product.name, image_url: product.image, gallery: product.gallery ?? [product.image],
  alt: product.alt, description: product.description ?? '', price: product.price ?? null, sale_price: product.salePrice ?? null,
  object_position: product.objectPosition ?? null, slug: product.slug ?? null, seo_title: product.seoTitle ?? null,
  image_transforms: product.imageTransforms ?? {},
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

export type ImageUploadPhase = 'preparing' | 'uploading'

const optimizeImageForUpload = async (file: File) => {
  const needsFormatConversion = /\.(?:heic|heif)$/i.test(file.name) || /image\/(?:heic|heif)/i.test(file.type)
  if (!needsFormatConversion && file.size <= 2_500_000) return file
  try {
    const bitmap = await createImageBitmap(file)
    const maximumSide = 2400
    const ratio = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) { bitmap.close(); return file }
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .86))
    if (!blob) return file
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'tootepilt'
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    // Safari can upload HEIC directly even if the browser cannot decode it via createImageBitmap.
    return file
  }
}

export async function uploadImages(storeId: string, files: File[], onPhase?: (index: number, phase: ImageUploadPhase) => void) {
  const client = requireSupabase()
  return Promise.all(files.map(async (originalFile, index) => {
    onPhase?.(index, 'preparing')
    const file = await optimizeImageForUpload(originalFile)
    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${storeId}/${createRandomId()}.${extension}`
    const contentType = file.type || (extension === 'heic' ? 'image/heic' : extension === 'heif' ? 'image/heif' : `image/${extension === 'jpg' ? 'jpeg' : extension}`)
    onPhase?.(index, 'uploading')
    const { error } = await client.storage.from('product-images').upload(path, file, { contentType, upsert: false })
    throwIfError(error)
    return client.storage.from('product-images').getPublicUrl(path).data.publicUrl
  }))
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
