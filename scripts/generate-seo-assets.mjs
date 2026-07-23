import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const outputDirectory = path.resolve('dist')
const platformOrigin = 'https://poeruum.ee'
const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SEO failide loomiseks puuduvad VITE_SUPABASE_URL või VITE_SUPABASE_PUBLISHABLE_KEY.')
}

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const escapeXml = escapeHtml
const cleanDescription = (value, fallback) => String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, 160)
const absoluteImageUrl = (value) => {
  if (!value) return null
  try { return new URL(value, platformOrigin).toString() }
  catch { return null }
}
const safeProductSlug = (product) => {
  const slug = String(product.slug || '')
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : String(product.id)
}
const productPrice = (product) => {
  const regular = Number(product.price ?? 0)
  const sale = product.sale_price == null ? null : Number(product.sale_price)
  return sale != null && sale < regular ? sale : regular
}

const response = await fetch(`${supabaseUrl}/rest/v1/rpc/storefront_seo_catalog`, {
  method: 'POST',
  headers: {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  },
  body: '{}',
})

if (!response.ok) {
  const details = await response.text()
  throw new Error(`SEO kataloogi laadimine ebaõnnestus (${response.status}): ${details.slice(0, 300)}`)
}

const catalog = await response.json()
if (!Array.isArray(catalog)) throw new Error('SEO kataloog ei ole oodatud kujul.')

const baseHtml = await readFile(path.join(outputDirectory, 'index.html'), 'utf8')
const seoBlockPattern = /<!-- poeruum:seo:start -->[\s\S]*?<!-- poeruum:seo:end -->/

const renderSeoBlock = ({ title, description, canonicalUrl, imageUrl, type = 'website', noIndex = false, structuredData }) => {
  const resolvedImage = absoluteImageUrl(imageUrl)
  return `<!-- poeruum:seo:start -->
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="${type}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:locale" content="et_EE" />
    ${resolvedImage ? `<meta property="og:image" content="${escapeHtml(resolvedImage)}" />
    <meta property="og:image:alt" content="${escapeHtml(title)}" />` : ''}
    <meta name="twitter:card" content="${resolvedImage ? 'summary_large_image' : 'summary'}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${resolvedImage ? `<meta name="twitter:image" content="${escapeHtml(resolvedImage)}" />` : ''}
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    ${structuredData ? `<script type="application/ld+json" data-poeruum-structured-data>${JSON.stringify(structuredData).replace(/</g, '\\u003c')}</script>` : ''}
    <!-- poeruum:seo:end -->`
}

const renderPage = (metadata) => baseHtml
  .replace(seoBlockPattern, renderSeoBlock(metadata))
  .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(metadata.title)}</title>`)

const writePage = async (relativePath, html) => {
  const directory = path.join(outputDirectory, relativePath)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'index.html'), html)
}

const sitemapEntries = [{
  url: `${platformOrigin}/`,
  lastModified: new Date().toISOString(),
  changeFrequency: 'weekly',
  priority: '1.0',
}]

let storePageCount = 0
let productPageCount = 0

const platformPages = [
  {
    path: 'kasutustingimused',
    title: 'Kasutustingimused — Poeruum',
    description: 'Poeruumi e-poeplatvormi kasutamise tingimused kaupmehele.',
    canonicalUrl: `${platformOrigin}/kasutustingimused/`,
  },
  {
    path: 'privaatsus',
    title: 'Privaatsuspoliitika — Poeruum',
    description: 'Kuidas Poeruum kaupmeeste ja ostjate isikuandmeid töötleb ning kaitseb.',
    canonicalUrl: `${platformOrigin}/privaatsus/`,
  },
]

for (const page of platformPages) {
  await writePage(page.path, renderPage({
    ...page,
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.title,
      description: page.description,
      url: page.canonicalUrl,
      isPartOf: { '@type': 'WebSite', name: 'Poeruum', url: `${platformOrigin}/` },
    },
  }))
  sitemapEntries.push({
    url: page.canonicalUrl,
    lastModified: new Date().toISOString(),
    changeFrequency: 'monthly',
    priority: '0.4',
  })
}

await writePage('admin', renderPage({
  title: 'Administraatori töölaud — Poeruum',
  description: 'Poeruumi administraatori turvaline sisselogimine.',
  canonicalUrl: `${platformOrigin}/admin/`,
  noIndex: true,
}))

for (const store of catalog) {
  const storeSlug = String(store.store_slug)
  const storeName = String(store.store_name)
  const storeUrl = `${platformOrigin}/p/${encodeURIComponent(storeSlug)}/`
  const storeDescription = cleanDescription(store.store_description, `${storeName} e-pood Poeruumis.`)
  const storeLogo = absoluteImageUrl(store.store_logo)
  const products = Array.isArray(store.products) ? store.products : []
  const storeImage = storeLogo || absoluteImageUrl(products[0]?.image_url)

  await writePage(`p/${storeSlug}`, renderPage({
    title: `${storeName} – e-pood`,
    description: storeDescription,
    canonicalUrl: storeUrl,
    imageUrl: storeImage,
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'OnlineStore',
      name: storeName,
      description: storeDescription,
      url: storeUrl,
      ...(storeLogo ? { logo: storeLogo } : {}),
    },
  }))
  storePageCount += 1
  sitemapEntries.push({
    url: storeUrl,
    lastModified: store.store_updated_at,
    changeFrequency: 'daily',
    priority: '0.8',
  })

  for (const product of products) {
    const productSlug = safeProductSlug(product)
    const productUrl = `${storeUrl}toode/${encodeURIComponent(productSlug)}/`
    const title = String(product.seo_title || `${product.name} – ${storeName}`)
    const description = cleanDescription(product.description, `${product.name} e-poes ${storeName}.`)
    const imageUrl = absoluteImageUrl(product.image_url)
    const price = productPrice(product)
    const inStock = product.one_of_a_kind ? Number(product.stock ?? 1) > 0 : product.stock == null || Number(product.stock) > 0

    await writePage(`p/${storeSlug}/toode/${productSlug}`, renderPage({
      title,
      description,
      canonicalUrl: productUrl,
      imageUrl,
      type: 'product',
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description,
        image: imageUrl ? [imageUrl] : [],
        sku: product.id,
        url: productUrl,
        brand: { '@type': 'Brand', name: storeName },
        offers: {
          '@type': 'Offer',
          priceCurrency: 'EUR',
          price: price.toFixed(2),
          availability: `https://schema.org/${inStock ? 'InStock' : 'OutOfStock'}`,
          url: productUrl,
          itemCondition: 'https://schema.org/NewCondition',
        },
      },
    }))
    productPageCount += 1
    sitemapEntries.push({
      url: productUrl,
      lastModified: product.updated_at,
      changeFrequency: 'daily',
      priority: '0.7',
    })
  }
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.map((entry) => `  <url>
    <loc>${escapeXml(entry.url)}</loc>
    <lastmod>${escapeXml(new Date(entry.lastModified || Date.now()).toISOString())}</lastmod>
    <changefreq>${entry.changeFrequency}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`).join('\n')}
</urlset>
`

const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /*?checkout=
Disallow: /*?billing=

Sitemap: ${platformOrigin}/sitemap-live.txt
`

await Promise.all([
  writeFile(path.join(outputDirectory, 'sitemap.xml'), sitemap),
  writeFile(path.join(outputDirectory, 'robots.txt'), robots),
])

console.log(`SEO: ${storePageCount} poe lehte, ${productPageCount} tootelehte ja ${sitemapEntries.length} sitemap URL-i.`)
