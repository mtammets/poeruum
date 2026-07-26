import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(root, 'dist')
const platformHost = 'poeruum.ee'
const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
const port = Number(process.env.PORT || 10000)
const storeCache = new Map()

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
const slugFromHost = (host) => {
  const normalized = host.toLowerCase().split(':')[0].replace(/\.$/, '')
  const match = normalized.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)\.poeruum\.ee$/)
  return match?.[1] && !['www', 'admin'].includes(match[1]) ? match[1] : null
}
const routeFromPath = (pathname) => {
  const pathStore = pathname.match(/^\/p\/([^/]+)(?:\/|$)/)?.[1]
  const product = pathname.match(/(?:^|\/)toode\/([^/]+)\/?$/)?.[1]
  return { pathStore: pathStore ? decodeURIComponent(pathStore).toLowerCase() : null, product: product ? decodeURIComponent(product).toLowerCase() : null }
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
    <meta property="og:site_name" content="${escapeHtml(schema?.brand?.name || schema?.name || 'Poeruum')}" />
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
    .replace(/<!-- poeruum:seo:start -->[\s\S]*?<!-- poeruum:seo:end -->/, seoBlock({
      title, description, canonical, image, type: product ? 'product' : 'website',
      noIndex: product?.search_visible === false, schema, verification: settings.searchConsoleVerification,
    }))
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<!-- poeruum:content:start -->[\s\S]*?<!-- poeruum:content:end -->/, `<!-- poeruum:content:start -->${fallback}<!-- poeruum:content:end -->`)
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
    const assetPath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, '')
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

    const { pathStore, product: productSlug } = routeFromPath(url.pathname)
    let slug = pathStore || slugFromHost(host)
    if (!slug && host !== platformHost && host !== `www.${platformHost}` && !host.endsWith('.onrender.com')) {
      slug = await resolveCustomDomain(host)
    }
    if (!slug) {
      const isPlatformRequest = host === platformHost || host === `www.${platformHost}` || host.endsWith('.onrender.com')
      if (isPlatformRequest) {
        const isAdminRequest = /^\/admin(?:\/(?:homepage|seo|users|support))?\/?$/i.test(url.pathname)
        if (isAdminRequest) {
          const body = await templatePromise
          return send(res, 200, req.method === 'HEAD' ? null : body, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
            'X-Robots-Tag': 'noindex, nofollow',
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
