import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const outputDirectory = path.resolve('dist')
const platformOrigin = 'https://poeruum.ee'
const excludedStoreSlugs = new Set(['test'])
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
const cleanDescription = (value, fallback, maxLength = 160) => String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, maxLength)
const absoluteImageUrl = (value) => {
  if (!value) return null
  try { return new URL(value, platformOrigin).toString() }
  catch { return null }
}
const imageMimeType = (url, explicitType) => {
  if (explicitType) return explicitType
  if (/\.png(?:[?#]|$)/i.test(url || '')) return 'image/png'
  if (/\.jpe?g(?:[?#]|$)/i.test(url || '')) return 'image/jpeg'
  if (/\.webp(?:[?#]|$)/i.test(url || '')) return 'image/webp'
  return null
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

const homepageSettingsResponse = await fetch(
  `${supabaseUrl}/rest/v1/platform_settings?select=social_image_path,seo_title,seo_description,social_title,social_description,search_indexing_enabled,seo_updated_at&id=eq.homepage`,
  {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  },
)
if (!homepageSettingsResponse.ok) {
  const details = await homepageSettingsResponse.text()
  throw new Error(`Avalehe SEO seadistuse laadimine ebaõnnestus (${homepageSettingsResponse.status}): ${details.slice(0, 300)}`)
}
const homepageSettings = (await homepageSettingsResponse.json())?.[0] ?? {}
const homepageSocialPath = typeof homepageSettings.social_image_path === 'string'
  ? homepageSettings.social_image_path
  : ''
const homepageSocialVersion = homepageSocialPath
const homepageSocialType = homepageSocialPath
  ? (homepageSocialPath.endsWith('.webp') ? 'image/webp' : 'image/png')
  : undefined
const homepageSeoTitle = String(homepageSettings.seo_title || 'Poeruum – loo Eesti e-pood 10 minutiga')
const homepageSeoDescription = cleanDescription(
  homepageSettings.seo_description,
  'Loo professionaalne e-pood umbes 10 minutiga. Lisa tooted telefonist, võta vastu makseid ning halda tellimusi ja tarnet ühest lihtsast keskkonnast.',
  200,
)
const homepageSocialTitle = String(homepageSettings.social_title || 'Lihtne e-pood Eesti väikeettevõtjale')
const homepageSocialDescription = cleanDescription(
  homepageSettings.social_description,
  'Lisa tooted, võta vastu makseid ja halda tellimusi ühest kohast.',
  200,
)
const homepageIndexingEnabled = homepageSettings.search_indexing_enabled !== false

const baseHtml = await readFile(path.join(outputDirectory, 'index.html'), 'utf8')
const seoBlockPattern = /<!-- poeruum:seo:start -->[\s\S]*?<!-- poeruum:seo:end -->/
const contentBlockPattern = /<!-- poeruum:content:start -->[\s\S]*?<!-- poeruum:content:end -->/
const fallbackLoaderMarkup = '<svg class="seo-fallback__logo" viewBox="0 0 40 40" aria-label="Poeruum laadib" role="img"><rect x="1" y="1" width="38" height="38" rx="11" /><path d="M10 16.5h20l-1.7 15H11.7L10 16.5Z" /><path class="seo-fallback__handle" d="M14.8 18v-3.2C14.8 11.3 16.9 9 20 9s5.2 2.3 5.2 5.8V18" /><path d="M15.5 22.2h9" /></svg>'

const renderSeoBlock = ({ title, description, socialTitle, socialDescription, canonicalUrl, imageUrl, imageWidth, imageHeight, imageType, type = 'website', noIndex = false, structuredData }) => {
  const resolvedImage = absoluteImageUrl(imageUrl)
  const resolvedImageType = imageMimeType(resolvedImage, imageType)
  const resolvedSocialTitle = socialTitle || title
  const resolvedSocialDescription = socialDescription || description
  return `<!-- poeruum:seo:start -->
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}" />
    <meta property="og:title" content="${escapeHtml(resolvedSocialTitle)}" />
    <meta property="og:description" content="${escapeHtml(resolvedSocialDescription)}" />
    <meta property="og:type" content="${type}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:locale" content="et_EE" />
    ${resolvedImage ? `<meta property="og:image" content="${escapeHtml(resolvedImage)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(resolvedImage)}" />
    <meta property="og:image:alt" content="${escapeHtml(resolvedSocialTitle)}" />
    ${resolvedImageType ? `<meta property="og:image:type" content="${resolvedImageType}" />` : ''}
    ${imageWidth && imageHeight ? `<meta property="og:image:width" content="${imageWidth}" />
    <meta property="og:image:height" content="${imageHeight}" />` : ''}` : ''}
    <meta name="twitter:card" content="${resolvedImage ? 'summary_large_image' : 'summary'}" />
    <meta name="twitter:title" content="${escapeHtml(resolvedSocialTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(resolvedSocialDescription)}" />
    ${resolvedImage ? `<meta name="twitter:image" content="${escapeHtml(resolvedImage)}" />` : ''}
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    ${structuredData ? `<script type="application/ld+json" data-poeruum-structured-data>${JSON.stringify(structuredData).replace(/</g, '\\u003c')}</script>` : ''}
    <!-- poeruum:seo:end -->`
}

const renderPage = (metadata) => baseHtml
  .replace(seoBlockPattern, renderSeoBlock(metadata))
  .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(metadata.title)}</title>`)
  .replace(contentBlockPattern, `<!-- poeruum:content:start --><main class="seo-fallback">${fallbackLoaderMarkup}<div><span>${escapeHtml(metadata.eyebrow || 'Poeruum')}</span><h1>${escapeHtml(metadata.heading || metadata.title)}</h1><p>${escapeHtml(metadata.description)}</p>${metadata.ctaUrl ? `<a href="${escapeHtml(metadata.ctaUrl)}">${escapeHtml(metadata.ctaLabel || 'Ava leht')}</a>` : ''}</div></main><!-- poeruum:content:end -->`)

const writePage = async (relativePath, html) => {
  const directory = path.join(outputDirectory, relativePath)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'index.html'), html)
}

const sitemapEntries = homepageIndexingEnabled ? [{
  url: `${platformOrigin}/`,
  lastModified: homepageSettings.seo_updated_at || new Date().toISOString(),
  changeFrequency: 'weekly',
  priority: '1.0',
}] : []

let storePageCount = 0
let productPageCount = 0

const homepageMetadata = {
  title: homepageSeoTitle,
  description: homepageSeoDescription,
  socialTitle: homepageSocialTitle,
  socialDescription: homepageSocialDescription,
  canonicalUrl: `${platformOrigin}/`,
  imageUrl: homepageSocialVersion
    ? `${supabaseUrl}/functions/v1/homepage-social-image?v=${encodeURIComponent(homepageSocialVersion)}`
    : undefined,
  imageType: homepageSocialType,
  imageWidth: homepageSocialVersion ? 1200 : undefined,
  imageHeight: homepageSocialVersion ? 630 : undefined,
  noIndex: !homepageIndexingEnabled,
  eyebrow: 'Eesti e-poeplatvorm',
  heading: 'Loo oma e-pood 10 minutiga',
  ctaUrl: '/#hind',
  ctaLabel: 'Vaata pakette',
  structuredData: {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${platformOrigin}/#website`,
        url: `${platformOrigin}/`,
        name: 'Poeruum',
        description: homepageSeoDescription,
        inLanguage: 'et',
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${platformOrigin}/#software`,
        url: `${platformOrigin}/`,
        name: 'Poeruum',
        description: homepageSeoDescription,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web browser',
        inLanguage: 'et',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'EUR',
          description: 'Paindlik pakett kuutasuta; tehingutasu rakendub müügilt.',
        },
        isPartOf: { '@id': `${platformOrigin}/#website` },
      },
    ],
  },
}

await writeFile(path.join(outputDirectory, 'index.html'), renderPage(homepageMetadata))

const platformPages = [
  {
    path: 'kasutustingimused',
    title: 'Kasutustingimused — Poeruum',
    description: 'Poeruumi e-poeplatvormi kasutamise tingimused kaupmehele.',
    canonicalUrl: `${platformOrigin}/kasutustingimused/`,
    eyebrow: 'Juriidiline teave',
    heading: 'Poeruumi kasutustingimused',
  },
  {
    path: 'privaatsus',
    title: 'Privaatsuspoliitika — Poeruum',
    description: 'Kuidas Poeruum kaupmeeste ja ostjate isikuandmeid töötleb ning kaitseb.',
    canonicalUrl: `${platformOrigin}/privaatsus/`,
    eyebrow: 'Juriidiline teave',
    heading: 'Poeruumi privaatsuspoliitika',
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
  eyebrow: 'Poeruum',
  heading: 'Administraatori töölaud',
}))

for (const excludedSlug of excludedStoreSlugs) {
  await writePage(`p/${excludedSlug}`, renderPage({
    title: 'Lehte ei leitud — Poeruum',
    description: 'Seda e-poodi ei ole avalikult saadaval.',
    canonicalUrl: `${platformOrigin}/p/${excludedSlug}/`,
    noIndex: true,
  }))
}

for (const store of catalog.filter((entry) => !excludedStoreSlugs.has(String(entry.store_slug).toLowerCase()))) {
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
    eyebrow: 'E-pood Poeruumis',
    heading: storeName,
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
      eyebrow: storeName,
      heading: String(product.name),
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

Sitemap: ${platformOrigin}/sitemap.xml
`

await Promise.all([
  writeFile(path.join(outputDirectory, 'sitemap.xml'), sitemap),
  writeFile(path.join(outputDirectory, 'robots.txt'), robots),
])

console.log(`SEO: ${storePageCount} poe lehte, ${productPageCount} tootelehte ja ${sitemapEntries.length} sitemap URL-i.`)
