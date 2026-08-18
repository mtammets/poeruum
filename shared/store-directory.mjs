const directorySlug = 'kaubamaja'
const validSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const validHostname = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

const asRecord = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null
const cleanText = (value, maxLength) => typeof value === 'string'
  ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
  : ''

const normalizeHostname = (value, slug) => {
  const candidate = cleanText(value, 253).toLowerCase().replace(/\.$/, '')
  if (candidate && validHostname.test(candidate)) return candidate
  return `${slug}.poeruum.ee`
}

const normalizeImageUrl = (value) => {
  const candidate = cleanText(value, 2_048)
  if (!candidate) return null
  try {
    const url = new globalThis.URL(candidate, 'https://poeruum.ee')
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

const normalizeMoney = (value) => {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null
}

const normalizeStock = (value) => {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null
}

export function formatStoreDirectoryPrice(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return `${value.toLocaleString('et-EE', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })} €`
}

export function getStoreDirectoryFeaturedUrl(store) {
  const record = asRecord(store)
  const storeUrl = cleanText(record?.url, 2_048)
  const product = asRecord(record?.featuredProduct ?? record?.featured_product)
  const productSlug = cleanText(product?.slug, 160)
  if (!storeUrl || !productSlug) return storeUrl

  try {
    return new globalThis.URL(`/toode/${encodeURIComponent(productSlug)}/`, storeUrl).toString()
  } catch {
    return storeUrl
  }
}

export function normalizeStoreDirectoryCatalog(value) {
  if (!Array.isArray(value)) return []

  const seen = new Set()
  return value.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []

    const slug = cleanText(record.store_slug ?? record.slug, 80).toLowerCase()
    const name = cleanText(record.store_name ?? record.name, 120)
    const id = cleanText(record.store_id ?? record.id, 120)
    if (!id || !name || !validSlug.test(slug) || slug === directorySlug || seen.has(id)) return []

    const products = Array.isArray(record.products) ? record.products : []
    const productWithImage = products.find((product) => {
      const productRecord = asRecord(product)
      return productRecord && normalizeImageUrl(productRecord.imageUrl ?? productRecord.image_url)
    })
    const productRecord = asRecord(record.featuredProduct ?? record.featured_product) || asRecord(productWithImage)
    const price = normalizeMoney(productRecord?.price)
    const salePriceCandidate = normalizeMoney(productRecord?.salePrice ?? productRecord?.sale_price)
    const salePrice = price !== null && salePriceCandidate !== null && salePriceCandidate < price
      ? salePriceCandidate
      : null
    const productId = cleanText(productRecord?.id, 120)
    const productName = cleanText(productRecord?.name, 160)
    const productSlug = cleanText(productRecord?.slug, 160)
    const logoUrl = normalizeImageUrl(record.logoUrl ?? record.store_logo)
    const imageUrl = normalizeImageUrl(record.imageUrl)
      || normalizeImageUrl(productRecord?.imageUrl ?? productRecord?.image_url)
      || logoUrl
    const hostname = normalizeHostname(record.primary_hostname ?? record.hostname, slug)
    const featuredProduct = productId && productName ? {
      id: productId,
      name: productName,
      slug: productSlug,
      description: cleanText(productRecord?.description, 5_000),
      price,
      salePrice,
      stock: normalizeStock(productRecord?.stock),
      oneOfAKind: productRecord?.oneOfAKind === true || productRecord?.one_of_a_kind === true,
    } : null

    seen.add(id)
    return [{
      id,
      name,
      slug,
      hostname,
      url: `https://${hostname}/`,
      imageUrl,
      logoUrl,
      featuredProduct,
      description: cleanText(record.store_description ?? record.description, 180),
    }]
  })
}
