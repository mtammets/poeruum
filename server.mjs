import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  decodePathname,
  getProductSlugFromPath,
  getStoreSlugFromHostname,
  getStoreSlugFromPath,
} from './shared/storefront-route.mjs'
import {
  getStoreDirectoryVisitUrl,
  normalizeStoreDirectoryCatalog,
} from './shared/store-directory.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(root, 'dist')
const platformHost = 'poeruum.ee'
const storeDirectoryHost = `kaubamaja.${platformHost}`
const legacyKaubamajaStoreSlug = 'urgits'
const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
const port = Number(process.env.PORT || 10000)
const storeCache = new Map()
let storeDirectoryCache = { value: null, expires: 0 }

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://checkout.stripe.com; script-src 'self' https://challenges.cloudflare.com https://connect-js.stripe.com https://js.stripe.com; style-src 'self' https://fonts.googleapis.com; style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com https://connect-js.stripe.com https://api.stripe.com https://*.stripe.com https://ariregister.rik.ee https://aks.geoportaal.ee https://www.omniva.ee; frame-src https://challenges.cloudflare.com https://connect-js.stripe.com https://js.stripe.com https://*.stripe.com; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const cleanText = (value, fallback, length = 160) =>
  String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, length)
const routeFromPath = (pathname) => {
  return {
    pathStore: getStoreSlugFromPath(pathname),
    product: getProductSlugFromPath(pathname),
  }
}
const absoluteImage = (value) => {
  if (!value) return null
  try { return new URL(value, `https://${platformHost}`).toString() } catch { return null }
}
const productPrice = (product) => {
  const regular = Number(product.price ?? 0)
  const sale = product.sale_price == null ? null : Number(product.sale_price)
  return sale != null && sale < regular ? sale : regular
}

async function resolveCustomDomain(hostname) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/resolve_store_slug_for_hostname`, {
    method: 'POST',
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requested_hostname: hostname }),
  })
  if (!response.ok) return null
  return await response.json()
}

async function getStore(slug) {
  const cached = storeCache.get(slug)
  if (cached && cached.expires > Date.now()) return cached.value
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/storefront_seo_document`, {
    method: 'POST',
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requested_slug: slug }),
  })
  if (!response.ok) return null
  const value = await response.json()
  storeCache.set(slug, { value, expires: Date.now() + 30_000 })
  return value
}

async function getStoreDirectory() {
  if (storeDirectoryCache.value && storeDirectoryCache.expires > Date.now()) {
    return storeDirectoryCache.value
  }
  if (!supabaseUrl || !supabaseKey) return storeDirectoryCache.value || []

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/storefront_seo_catalog`, {
      method: 'POST',
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) throw new Error(`Poodide kataloog vastas staatusega ${response.status}.`)
    const value = normalizeStoreDirectoryCatalog(await response.json())
    storeDirectoryCache = { value, expires: Date.now() + 60_000 }
    return value
  } catch (error) {
    if (storeDirectoryCache.value) return storeDirectoryCache.value
    throw error
  }
}

const seoBlock = ({ title, description, canonical, image, type, noIndex, schema, verification }) => {
  const resolvedImage = absoluteImage(image)
  return `<!-- poeruum:seo:start -->
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="${type}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:locale" content="et_EE" />
    <meta property="og:site_name" content="${escapeHtml(schema?.brand?.name || schema?.isPartOf?.name || schema?.name || 'Poeruum')}" />
    ${resolvedImage ? `<meta property="og:image" content="${escapeHtml(resolvedImage)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(resolvedImage)}" />
    <meta property="og:image:alt" content="${escapeHtml(title)}" />` : ''}
    <meta name="twitter:card" content="${resolvedImage ? 'summary_large_image' : 'summary'}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${resolvedImage ? `<meta name="twitter:image" content="${escapeHtml(resolvedImage)}" />` : ''}
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    ${verification ? `<meta name="google-site-verification" content="${escapeHtml(verification)}" />` : ''}
    <script type="application/ld+json" data-poeruum-structured-data>${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
    <!-- poeruum:seo:end -->`
}

function renderStorefront(template, store, product) {
  const settings = store.settings || {}
  const host = store.primary_hostname
  const base = `https://${host}`
  const canonical = product ? `${base}/toode/${encodeURIComponent(product.slug)}/` : `${base}/`
  const title = product
    ? product.seo_title || `${product.name} – ${store.store_name}`
    : settings.seoTitle || `${store.store_name} – e-pood`
  const description = product
    ? cleanText(product.description, `${product.name} e-poes ${store.store_name}.`)
    : cleanText(settings.seoDescription || settings.storeDescription, `${store.store_name} e-pood.`)
  const gallery = product ? [product.image_url, ...(Array.isArray(product.gallery) ? product.gallery : [])].filter(Boolean) : []
  const image = product?.image_url || settings.socialImage || settings.storeLogo || store.products?.[0]?.image_url
  const available = product ? (product.one_of_a_kind ? Number(product.stock ?? 1) > 0 : product.stock == null || Number(product.stock) > 0) : false
  const shippingRate = settings.deliverySettings?.parcelProviders
    ? Math.min(...Object.values(settings.deliverySettings.parcelProviders).filter((item) => item?.enabled).map((item) => Number(item.price)).filter(Number.isFinite))
    : null
  const returnDays = Number(String(settings.returnsText || '').match(/(\d+)\s+päeva/i)?.[1] || 14)
  const returnPolicy = {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: 'EE',
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: returnDays,
  }
  const schema = product ? {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description,
    image: [...new Set(gallery.map(absoluteImage).filter(Boolean))],
    sku: product.id,
    url: canonical,
    brand: { '@type': 'Brand', name: settings.productBrand || store.store_name },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'EUR',
      price: productPrice(product).toFixed(2),
      availability: `https://schema.org/${available ? 'InStock' : 'OutOfStock'}`,
      url: canonical,
      itemCondition: 'https://schema.org/NewCondition',
      seller: {
        '@type': 'Organization',
        name: settings.businessName || store.store_name,
        hasMerchantReturnPolicy: returnPolicy,
      },
      ...(Number.isFinite(shippingRate) ? {
        shippingDetails: {
          '@type': 'OfferShippingDetails',
          shippingRate: { '@type': 'MonetaryAmount', value: shippingRate.toFixed(2), currency: 'EUR' },
          shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'EE' },
        },
      } : {}),
    },
  } : {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: store.store_name,
    description,
    url: canonical,
    ...(settings.storeLogo ? { logo: absoluteImage(settings.storeLogo) } : {}),
    ...(settings.contactEmail ? { email: settings.contactEmail } : {}),
    ...(settings.contactPhone ? { telephone: settings.contactPhone } : {}),
    hasMerchantReturnPolicy: returnPolicy,
  }
  const links = !product
    ? `<nav aria-label="Tooted">${(store.products || []).filter((item) => item.search_visible).map((item) =>
      `<a href="/toode/${escapeHtml(item.slug)}/">${escapeHtml(item.name)}</a>`).join('')}</nav>`
    : `<a href="/">Tagasi poodi ${escapeHtml(store.store_name)}</a>`
  const fallback = `<main class="seo-fallback"><div><span>${escapeHtml(product ? store.store_name : 'E-pood')}</span><h1>${escapeHtml(product?.name || store.store_name)}</h1><p>${escapeHtml(description)}</p>${links}</div></main>`
  return template
    .replace('<html lang="et" data-app-surface="platform">', '<html lang="et" data-app-surface="storefront">')
    .replace('<meta name="theme-color" content="#f4f2e9" />', '<meta name="theme-color" content="#000000" />')
    .replace(/<!-- poeruum:seo:start -->[\s\S]*?<!-- poeruum:seo:end -->/, seoBlock({
      title, description, canonical, image, type: product ? 'product' : 'website',
      noIndex: product?.search_visible === false, schema, verification: settings.searchConsoleVerification,
    }))
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<!-- poeruum:content:start -->[\s\S]*?<!-- poeruum:content:end -->/, `<!-- poeruum:content:start -->${fallback}<!-- poeruum:content:end -->`)
}

function renderStoreDirectory(template, stores) {
  const canonical = `https://${storeDirectoryHost}/`
  const title = 'Poeruumi Kaubamaja'
  const heading = 'Avasta Poeruumis loodud Eesti e-poode'
  const description = 'Poeruumi Kaubamaja koondab ühte kohta Eesti ettevõtjate e-poed. Sirvi valikut ja leia uusi poode, tooteid ning tegijaid.'
  const heroImage = `${canonical}images/poeruumi-kaubamaja-hero.webp`
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonical,
    inLanguage: 'et',
    isPartOf: { '@type': 'WebSite', name: 'Poeruum', url: `https://${platformHost}/` },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: stores.length,
      itemListElement: stores.map((store, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: store.name,
        url: store.url,
      })),
    },
  }
  const brand = `<div class="platform-brand" aria-label="Poeruum"><span class="platform-brand__mark" aria-hidden="true"><svg viewBox="0 0 40 40"><rect x="1" y="1" width="38" height="38" rx="11"></rect><path d="M10 16.5h20l-1.7 15H11.7L10 16.5Z"></path><path d="M14.8 18v-3.2C14.8 11.3 16.9 9 20 9s5.2 2.3 5.2 5.8V18"></path><path d="M15.5 22.2h9"></path></svg></span><strong>Poe<span>ruum</span></strong></div>`
  const arrowUpRight = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 15 15 5M7 5h8v8"></path></svg>'
  const cards = stores.map((store, index) => {
    const cardDescription = store.description || 'Avasta poe valikut.'
    const visitUrl = getStoreDirectoryVisitUrl(store)
    const logo = `<span class="store-directory__identity-mark" aria-hidden="true"><b>${escapeHtml(store.name.charAt(0).toLocaleUpperCase('et'))}</b>${store.logoUrl ? `<img src="${escapeHtml(store.logoUrl)}" alt="" loading="lazy" decoding="async">` : ''}</span>`
    return `<article class="store-directory__card"><a class="store-directory__card-link" href="${escapeHtml(visitUrl)}" aria-label="Ava pood ${escapeHtml(store.name)}"><div class="store-directory__media">${store.imageUrl ? `<img class="store-directory__cover" src="${escapeHtml(store.imageUrl)}" alt="" loading="${index < 2 ? 'eager' : 'lazy'}"${index === 0 ? ' fetchpriority="high"' : ''} decoding="async">` : ''}<span class="store-directory__card-shade" aria-hidden="true"></span></div><div class="store-directory__card-copy"><div class="store-directory__identity">${logo}<div><h3>${escapeHtml(store.name)}</h3><p>${escapeHtml(cardDescription)}</p></div></div><span class="store-directory__card-cta" aria-hidden="true">Ava pood${arrowUpRight}</span></div></a></article>`
  }).join('')
  const empty = '<div class="store-directory__empty"><p>Uued poed jõuavad siia peagi.</p></div>'
  const content = `<main class="store-directory"><nav class="store-directory__nav" aria-label="Poeruumi Kaubamaja"><a class="store-directory__brand" href="https://${platformHost}/" aria-label="Poeruumi avaleht">${brand}<span class="store-directory__brand-rule" aria-hidden="true"></span><span class="store-directory__brand-edition">Kaubamaja</span></a><a class="store-directory__create" href="https://${platformHost}/#hind"><span class="store-directory__create-full">Loo oma pood</span><span class="store-directory__create-short">Loo pood</span>${arrowUpRight}</a></nav><header class="store-directory__hero"><div class="store-directory__hero-media" aria-hidden="true"><img src="/images/poeruumi-kaubamaja-hero.webp" alt="" fetchpriority="high" decoding="async"></div><div class="store-directory__intro"><h1>${heading}</h1><p>${description}</p></div></header><section class="store-directory__stores" aria-labelledby="store-directory-heading"><div class="store-directory__section-head"><h2 id="store-directory-heading">Leia oma uus lemmikpood</h2></div>${stores.length ? `<div class="store-directory__grid">${cards}</div>` : empty}</section><footer class="store-directory__footer"><span>© 2026 Poeruum</span><div><a href="https://${platformHost}/mis-on-poeruum/">Mis on Poeruum?</a><a href="https://${platformHost}/#hind">Loo oma pood ${arrowUpRight}</a></div></footer></main>`
  const initialData = JSON.stringify(stores).replace(/</g, '\\u003c')

  return template
    .replace(/<!-- poeruum:seo:start -->[\s\S]*?<!-- poeruum:seo:end -->/, seoBlock({
      title,
      description,
      canonical,
      image: heroImage,
      type: 'website',
      noIndex: false,
      schema,
    }))
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace('</head>', `<script type="application/json" id="poeruum-store-directory-data">${initialData}</script></head>`)
    .replace(/<!-- poeruum:content:start -->[\s\S]*?<!-- poeruum:content:end -->/, `<!-- poeruum:content:start -->${content}<!-- poeruum:content:end -->`)
}

const mime = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' }
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { ...securityHeaders, ...headers })
  res.end(body)
}

const templatePromise = readFile(path.join(dist, 'index.html'), 'utf8')
createServer(async (req, res) => {
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || platformHost).split(',')[0].trim().toLowerCase().split(':')[0]
    const url = new URL(req.url || '/', `https://${host}`)
    const decodedPathname = decodePathname(url.pathname)
    if (decodedPathname === null) {
      return send(res, 400, 'Vigane veebiaadress.', {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': 'noindex',
      })
    }
    const assetPath = path.normalize(decodedPathname).replace(/^(\.\.(\/|\\|$))+/, '')
    const file = path.join(dist, assetPath)
    const isStaticAsset = ['/assets/', '/images/', '/data/'].some((prefix) => url.pathname.startsWith(prefix))
      || ['/favicon.ico', '/manifest.webmanifest'].includes(url.pathname)
    if (isStaticAsset && !url.pathname.endsWith('/') && file.startsWith(dist)) {
      const fileStat = await stat(file).catch(() => null)
      if (fileStat?.isFile()) {
        const body = await readFile(file)
        return send(res, 200, req.method === 'HEAD' ? null : body, {
          'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
        })
      }
    }

    if (host === storeDirectoryHost) {
      if (/^\/toode\//i.test(url.pathname)) {
        const legacyUrl = new URL(url.pathname, `https://${legacyKaubamajaStoreSlug}.${platformHost}`)
        return send(res, 301, null, { Location: legacyUrl.toString() })
      }
      if (url.pathname === '/robots.txt') {
        return send(res, 200, `User-agent: *\nAllow: /\nSitemap: https://${storeDirectoryHost}/sitemap.xml\n`, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        })
      }
      if (url.pathname === '/sitemap.xml') {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://${storeDirectoryHost}/</loc></url>\n</urlset>\n`
        return send(res, 200, xml, {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        })
      }
      if (url.pathname !== '/') {
        return send(res, 404, 'Lehte ei leitud.', {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Robots-Tag': 'noindex',
        })
      }
      const html = renderStoreDirectory(await templatePromise, await getStoreDirectory())
      return send(res, 200, req.method === 'HEAD' ? null : html, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
      })
    }

    const { pathStore, product: productSlug } = routeFromPath(url.pathname)
    if (pathStore === 'kaubamaja') {
      const legacyPath = productSlug ? `/toode/${encodeURIComponent(productSlug)}/` : '/'
      return send(res, 301, null, { Location: `https://${legacyKaubamajaStoreSlug}.${platformHost}${legacyPath}` })
    }
    let slug = pathStore || getStoreSlugFromHostname(host, platformHost)
    if (!slug && host !== platformHost && host !== `www.${platformHost}` && !host.endsWith('.onrender.com')) {
      slug = await resolveCustomDomain(host)
    }
    if (!slug) {
      const isPlatformRequest = host === platformHost || host === `www.${platformHost}` || host.endsWith('.onrender.com')
      if (isPlatformRequest) {
        const isAdminRequest = /^\/admin(?:\/(?:analytics|homepage|seo|leads|users|support))?\/?$/i.test(url.pathname)
        const isUnsubscribeRequest = /^\/loobu\/?$/i.test(url.pathname)
        if (isAdminRequest || isUnsubscribeRequest) {
          const body = await templatePromise
          return send(res, 200, req.method === 'HEAD' ? null : body, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
            'X-Robots-Tag': isAdminRequest ? 'noindex, nofollow' : 'noindex',
          })
        }
        const relative = url.pathname === '/' ? 'index.html' : path.join(url.pathname.replace(/^\/+|\/+$/g, ''), 'index.html')
        const platformFile = path.join(dist, relative)
        const platformStat = await stat(platformFile).catch(() => null)
        if (platformStat?.isFile()) {
          const body = await readFile(platformFile)
          return send(res, 200, req.method === 'HEAD' ? null : body, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=0, s-maxage=300',
          })
        }
        if (['/robots.txt', '/sitemap.xml'].includes(url.pathname)) {
          const body = await readFile(path.join(dist, url.pathname.slice(1))).catch(() => null)
          if (body) return send(res, 200, req.method === 'HEAD' ? null : body, {
            'Content-Type': url.pathname.endsWith('.xml') ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=0, s-maxage=300',
          })
        }
      }
      const template = await templatePromise
      return send(res, 404, req.method === 'HEAD' ? null : template, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=300', 'X-Robots-Tag': 'noindex' })
    }

    const store = await getStore(slug)
    if (!store) return send(res, 404, 'Poodi ei leitud.', { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' })
    const primaryHost = String(store.primary_hostname).toLowerCase()
    const canonicalPath = productSlug ? `/toode/${encodeURIComponent(productSlug)}/` : '/'
    if (host !== primaryHost || pathStore) {
      return send(res, 301, null, { Location: `https://${primaryHost}${canonicalPath}` })
    }
    if (url.pathname === '/robots.txt') {
      return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /*?checkout=\nSitemap: https://${primaryHost}/sitemap.xml\n`, { 'Content-Type': 'text/plain; charset=utf-8' })
    }
    if (url.pathname === '/sitemap.xml') {
      const entries = [`https://${primaryHost}/`, ...(store.products || []).filter((item) => item.search_visible).map((item) => `https://${primaryHost}/toode/${encodeURIComponent(item.slug)}/`)]
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((entry) => `  <url><loc>${escapeHtml(entry)}</loc></url>`).join('\n')}\n</urlset>\n`
      return send(res, 200, xml, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=30, s-maxage=60' })
    }
    let product = null
    if (productSlug) {
      product = (store.products || []).find((item) => String(item.slug).toLowerCase() === productSlug)
      if (!product) {
        const history = (store.url_history || []).find((item) => item.old_slug === productSlug)
        if (history?.status === 'redirect' && history.new_slug) {
          return send(res, 301, null, { Location: `https://${primaryHost}/toode/${encodeURIComponent(history.new_slug)}/` })
        }
        return send(res, history?.status === 'gone' ? 410 : 404, 'Toodet ei leitud.', { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' })
      }
    }
    const html = renderStorefront(await templatePromise, store, product)
    return send(res, 200, req.method === 'HEAD' ? null : html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=120',
      ...(product?.search_visible === false ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
    })
  } catch (error) {
    console.error(error)
    send(res, 500, 'Lehe laadimine ebaõnnestus.', { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' })
  }
}).listen(port, '0.0.0.0', () => console.log(`Poeruum server kuulab pordil ${port}.`))
