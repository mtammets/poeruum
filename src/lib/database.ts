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

export async function getMyStore() {
  const { data, error } = await requireSupabase().from('stores').select('*').order('created_at').limit(1).maybeSingle()
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
  seoTitle: row.seo_title as string | undefined, searchVisible: Boolean(row.search_visible),
  stock: row.stock == null ? undefined : Number(row.stock), oneOfAKind: Boolean(row.one_of_a_kind),
  options: row.options as Product['options'],
})

const productToRow = (storeId: string, product: Product) => ({
  id: product.id, store_id: storeId, name: product.name, image_url: product.image, gallery: product.gallery ?? [product.image],
  alt: product.alt, description: product.description ?? '', price: product.price ?? null, sale_price: product.salePrice ?? null,
  object_position: product.objectPosition ?? null, slug: product.slug ?? null, seo_title: product.seoTitle ?? null,
  search_visible: product.searchVisible ?? true, stock: product.stock ?? null, one_of_a_kind: product.oneOfAKind ?? false,
  options: product.options ?? [],
})

export async function saveProduct(storeId: string, product: Product) {
  const { data, error } = await requireSupabase().from('products').upsert(productToRow(storeId, product)).select().single()
  throwIfError(error)
  return productFromRow(data as Record<string, unknown>)
}

export async function removeProduct(productId: string) {
  const { error } = await requireSupabase().from('products').delete().eq('id', productId)
  throwIfError(error)
}

export async function uploadImages(storeId: string, files: File[]) {
  const client = requireSupabase()
  return Promise.all(files.map(async (file) => {
    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${storeId}/${crypto.randomUUID()}.${extension}`
    const { error } = await client.storage.from('product-images').upload(path, file, { contentType: file.type, upsert: false })
    throwIfError(error)
    return client.storage.from('product-images').getPublicUrl(path).data.publicUrl
  }))
}

export async function listOrders(storeId: string) {
  const { data, error } = await requireSupabase().from('orders').select('*').eq('store_id', storeId).order('created_at', { ascending: false })
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
