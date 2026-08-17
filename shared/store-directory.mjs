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
      return productRecord && normalizeImageUrl(productRecord.image_url)
    })
    const productRecord = asRecord(productWithImage)
    const imageUrl = normalizeImageUrl(record.imageUrl)
      || normalizeImageUrl(productRecord?.image_url)
      || normalizeImageUrl(record.store_logo)
    const hostname = normalizeHostname(record.primary_hostname ?? record.hostname, slug)

    seen.add(id)
    return [{
      id,
      name,
      slug,
      hostname,
      url: `https://${hostname}/`,
      imageUrl,
      description: cleanText(record.store_description ?? record.description, 180),
    }]
  })
}
