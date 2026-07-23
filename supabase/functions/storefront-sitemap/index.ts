import { createClient } from 'npm:@supabase/supabase-js@2'

const platformOrigin = 'https://poeruum.ee'
const excludedStoreSlugs = new Set(['test'])

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' } })
  }
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 })

  try {
    if (new URL(request.url).searchParams.get('type') === 'robots') {
      const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /*?checkout=
Disallow: /*?billing=

Sitemap: ${platformOrigin}/sitemap-live.txt
`
      return new Response(request.method === 'HEAD' ? null : robots, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=300, s-maxage=3600',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await admin.rpc('storefront_seo_catalog')
    if (error) throw error
    const catalog = Array.isArray(data) ? data : []
    const urls = [
      `${platformOrigin}/`,
      `${platformOrigin}/kasutustingimused/`,
      `${platformOrigin}/privaatsus/`,
    ]

    for (const store of catalog) {
      const storeSlug = String(store.store_slug)
      if (excludedStoreSlugs.has(storeSlug.toLowerCase())) continue
      const storeUrl = `${platformOrigin}/p/${encodeURIComponent(storeSlug)}/`
      urls.push(storeUrl)
      for (const product of Array.isArray(store.products) ? store.products : []) {
        const productSlug = String(product.slug || product.id)
        urls.push(`${storeUrl}toode/${encodeURIComponent(productSlug)}/`)
      }
    }

    // Supabase's public function gateway serves non-JSON bodies as text/plain.
    // A plain-text sitemap is a standard sitemap format: exactly one absolute
    // URL per line, with no additional content.
    const sitemap = `${urls.join('\n')}\n`
    return new Response(request.method === 'HEAD' ? null : sitemap, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('Sitemapi loomine ebaõnnestus.', error)
    return new Response('Sitemapi loomine ebaõnnestus.', { status: 500 })
  }
})
