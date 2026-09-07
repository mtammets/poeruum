const directorySlug = 'kaubamaja'

// Promotional cards stay separate from the public catalog and search results.
export const storeDirectoryExamples = [
  {
    id: 'example-ceramics',
    name: 'Sinu keraamikapood',
    description: 'Keraamika, kodukaubad ja sinu looming.',
    imageUrl: '/images/kaubamaja-example-ceramics.webp',
    logoUrl: null,
    url: 'https://poeruum.ee/',
  },
  {
    id: 'example-jewelry',
    name: 'Sinu ehtepood',
    description: 'Ehted, aksessuaarid ja sinu looming.',
    imageUrl: '/images/kaubamaja-example-jewelry.webp',
    logoUrl: null,
    url: 'https://poeruum.ee/',
  },
  {
    id: 'example-fashion',
    name: 'Sinu rõivapood',
    description: 'Rõivad, kudumid ja sinu stiil.',
    imageUrl: '/images/kaubamaja-example-fashion.webp',
    logoUrl: null,
    url: 'https://poeruum.ee/',
  },
  {
    id: 'example-art',
    name: 'Sinu kunstipood',
    description: 'Kunst, sisustus ja sinu looming.',
    imageUrl: '/images/kaubamaja-example-art.webp',
    logoUrl: null,
    url: 'https://poeruum.ee/',
  },
  {
    id: 'example-chocolate',
    name: 'Sinu maiustustepood',
    description: 'Šokolaad, maiustused ja sinu retseptid.',
    imageUrl: '/images/kaubamaja-example-chocolate.webp',
    logoUrl: null,
    url: 'https://poeruum.ee/',
  },
  {
    id: 'example-bags',
    name: 'Sinu kotipood',
    description: 'Kotid, nahatööd ja sinu disain.',
    imageUrl: '/images/kaubamaja-example-bags.webp',
    logoUrl: null,
    url: 'https://poeruum.ee/',
  },
]

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

const normalizeProduct = (value) => {
  const record = asRecord(value)
  if (!record || record.search_visible === false || record.searchVisible === false) return null
  const id = cleanText(record.id, 120)
  const name = cleanText(record.name, 160)
  if (!id || !name) return null
  const price = normalizeMoney(record.price)
  const salePrice = normalizeMoney(record.salePrice ?? record.sale_price)
  return {
    id,
    name,
    slug: cleanText(record.slug, 160) || id,
    description: cleanText(record.description, 5_000),
    imageUrl: normalizeImageUrl(record.imageUrl ?? record.image_url),
    price,
    salePrice: price !== null && salePrice !== null && salePrice < price ? salePrice : null,
    stock: normalizeStock(record.stock),
    oneOfAKind: record.oneOfAKind === true || record.one_of_a_kind === true,
  }
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

export function getStoreDirectoryVisitUrl(store, product) {
  const record = asRecord(store)
  const storeUrl = cleanText(record?.url, 2_048)
  if (!storeUrl) return ''

  try {
    const productSlug = cleanText(asRecord(product)?.slug, 160) || cleanText(asRecord(product)?.id, 120)
    const url = productSlug
      ? new globalThis.URL(`/toode/${encodeURIComponent(productSlug)}/`, storeUrl)
      : new globalThis.URL(storeUrl)
    url.searchParams.set('from', directorySlug)
    return url.toString()
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

    const productIds = new Set()
    const products = (Array.isArray(record.products) ? record.products : []).flatMap((item) => {
      const product = normalizeProduct(item)
      if (!product || productIds.has(product.id)) return []
      productIds.add(product.id)
      return [product]
    })
    const featuredProduct = normalizeProduct(record.featuredProduct ?? record.featured_product)
      || products.find((product) => product.imageUrl) || null
    const logoUrl = normalizeImageUrl(record.logoUrl ?? record.store_logo)
    const directoryCoverUrl = normalizeImageUrl(record.directoryCoverUrl ?? record.directory_cover)
    const imageUrl = directoryCoverUrl || normalizeImageUrl(record.imageUrl)
      || featuredProduct?.imageUrl
      || logoUrl
    const hostname = normalizeHostname(record.primary_hostname ?? record.hostname, slug)

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
      products,
      description: cleanText(record.directory_description, 140)
        || cleanText(record.store_description ?? record.description, 140),
    }]
  })
}
