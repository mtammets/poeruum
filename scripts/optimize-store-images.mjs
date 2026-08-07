/* global createImageBitmap, document, FileReader */
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

config({ path: '.env', quiet: true })

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const storeSlug = process.argv.slice(2).find((argument) => !argument.startsWith('--'))
const apply = process.argv.includes('--apply')
if (!storeSlug) throw new Error('Kasuta käsku kujul: node scripts/optimize-store-images.mjs poe-aadress [--apply]')

const supabase = createClient(required('VITE_SUPABASE_URL'), required('SUPABASE_SECRET_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
})

const { data: store, error: storeError } = await supabase.from('stores').select('id,slug,settings').eq('slug', storeSlug).maybeSingle()
if (storeError) throw storeError
if (!store) throw new Error(`Poodi ${storeSlug} ei leitud.`)
const { data: products, error: productsError } = await supabase.from('products').select('*').eq('store_id', store.id).order('sort_order').order('created_at')
if (productsError) throw productsError

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

const encodeImage = async (url, specs) => page.evaluate(async ({ imageUrl, imageSpecs }) => {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error(`Pildi laadimine ebaõnnestus (${response.status}).`)
  const original = await response.blob()
  const bitmap = await createImageBitmap(original, { imageOrientation: 'from-image' })
  const encodedBySize = new Map()
  const roleToSize = {}
  try {
    for (const spec of imageSpecs) {
      const ratio = Math.min(1, spec.maximumSide / Math.max(bitmap.width, bitmap.height))
      const width = Math.max(1, Math.round(bitmap.width * ratio))
      const height = Math.max(1, Math.round(bitmap.height * ratio))
      const sizeKey = `${width}x${height}`
      roleToSize[spec.role] = sizeKey
      if (encodedBySize.has(sizeKey)) continue
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { alpha: true })
      if (!context) throw new Error('Brauser ei saanud pildi jaoks canvas-konteksti luua.')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, width, height)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', spec.quality))
      if (!blob || blob.type !== 'image/webp') throw new Error('Brauser ei loonud WebP pilti.')
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      encodedBySize.set(sizeKey, { role: spec.role, width, height, bytes: blob.size, dataUrl })
    }
  } finally {
    bitmap.close()
  }
  return {
    originalBytes: original.size,
    originalWidth: bitmap.width,
    originalHeight: bitmap.height,
    images: [...encodedBySize.entries()].map(([sizeKey, image]) => ({ sizeKey, ...image })),
    roleToSize,
  }
}, { imageUrl: url, imageSpecs: specs })

const productSpecs = [
  { role: 'master', maximumSide: 2400, quality: .84 },
  { role: 'large', maximumSide: 1600, quality: .82 },
  { role: 'medium', maximumSide: 960, quality: .8 },
  { role: 'thumb', maximumSide: 480, quality: .78 },
]

const dataUrlToBytes = (dataUrl) => Buffer.from(String(dataUrl).split(',')[1], 'base64')
const uploadSet = async (prefix, encoded) => {
  const uploadedPaths = []
  const uploadedBySize = new Map()
  try {
    for (const image of encoded.images) {
      const path = `${store.id}/${prefix}/${image.role}.webp`
      const { error } = await supabase.storage.from('product-images').upload(path, dataUrlToBytes(image.dataUrl), {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: false,
      })
      if (error) throw error
      uploadedPaths.push(path)
      const url = supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl
      uploadedBySize.set(image.sizeKey, { url, width: image.width, height: image.height, bytes: image.bytes })
    }
    return {
      uploadedPaths,
      asset: {
        mimeType: 'image/webp',
        variants: Object.fromEntries(Object.entries(encoded.roleToSize).map(([role, sizeKey]) => [role, uploadedBySize.get(sizeKey)])),
      },
    }
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from('product-images').remove(uploadedPaths)
    throw error
  }
}

let originalBytes = 0
let optimizedBytes = 0
const productPlans = []
for (const product of products ?? []) {
  const gallery = Array.isArray(product.gallery) && product.gallery.length ? product.gallery : [product.image_url]
  const images = []
  for (const url of gallery) {
    const encoded = await encodeImage(url, productSpecs)
    originalBytes += encoded.originalBytes
    optimizedBytes += encoded.images.reduce((total, image) => total + image.bytes, 0)
    images.push({ oldUrl: url, encoded })
  }
  productPlans.push({ product, images })
}

const settings = store.settings && typeof store.settings === 'object' ? store.settings : {}
const settingPlans = []
for (const input of [
  { key: 'storeLogo', maximumSide: 512, quality: .86 },
  { key: 'storeAboutImage', maximumSide: 1600, quality: .82 },
]) {
  const url = settings[input.key]
  if (typeof url !== 'string' || !url) continue
  const encoded = await encodeImage(url, [{ role: 'master', maximumSide: input.maximumSide, quality: input.quality }])
  originalBytes += encoded.originalBytes
  optimizedBytes += encoded.images.reduce((total, image) => total + image.bytes, 0)
  settingPlans.push({ ...input, encoded })
}

const megabytes = (bytes) => `${(bytes / 1_000_000).toFixed(2)} MB`
console.log(`${store.slug}: ${productPlans.length} toodet ja ${settingPlans.length} poepilti`)
console.log(`Praegused lähtefailid: ${megabytes(originalBytes)}`)
console.log(`Uued WebP variandid kokku: ${megabytes(optimizedBytes)}`)

if (apply) {
  for (const plan of productPlans) {
    const uploadedPaths = []
    try {
      const replacements = new Map()
      const imageVariants = {}
      for (const image of plan.images) {
        const uploaded = await uploadSet(randomUUID(), image.encoded)
        uploadedPaths.push(...uploaded.uploadedPaths)
        const masterUrl = uploaded.asset.variants.master.url
        replacements.set(image.oldUrl, masterUrl)
        imageVariants[masterUrl] = uploaded.asset
      }
      const gallery = plan.images.map((image) => replacements.get(image.oldUrl))
      const imageTransforms = Object.fromEntries(Object.entries(plan.product.image_transforms ?? {}).flatMap(([url, transform]) => {
        const replacement = replacements.get(url)
        return replacement ? [[replacement, transform]] : []
      }))
      const { error } = await supabase.from('products').update({
        image_url: replacements.get(plan.product.image_url) ?? gallery[0],
        gallery,
        image_variants: imageVariants,
        image_transforms: imageTransforms,
      }).eq('id', plan.product.id).eq('store_id', store.id)
      if (error) throw error
    } catch (error) {
      if (uploadedPaths.length) await supabase.storage.from('product-images').remove(uploadedPaths)
      throw error
    }
  }

  if (settingPlans.length) {
    const uploadedPaths = []
    const nextSettings = { ...settings }
    try {
      for (const plan of settingPlans) {
        const uploaded = await uploadSet(`assets/${randomUUID()}`, plan.encoded)
        uploadedPaths.push(...uploaded.uploadedPaths)
        nextSettings[plan.key] = uploaded.asset.variants.master.url
      }
      const { error } = await supabase.from('stores').update({ settings: nextSettings }).eq('id', store.id)
      if (error) throw error
    } catch (error) {
      if (uploadedPaths.length) await supabase.storage.from('product-images').remove(uploadedPaths)
      throw error
    }
  }
  console.log('Uued pildid on üles laaditud ja poe viited uuendatud. Vanad failid jäid tellimuste jaoks alles.')
} else {
  console.log('Kuivkäivitus valmis. Muudatuste rakendamiseks lisa --apply.')
}

await browser.close()
