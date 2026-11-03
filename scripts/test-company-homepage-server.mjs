import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { once } from 'node:events'

async function verify(primaryHost) {
  let published = true
  let companyHomepage = {}
  const settings = () => ({ storeDescription: 'Loodusest inspireeritud Eesti disain.', businessName: 'Krük-Krük OÜ', contactEmail: 'hello@example.invalid', companyHomepage })
  const backend = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}')
    let data = null
    if (req.url.startsWith('/rest/v1/public_storefronts?')) data = published ? [{ settings: settings() }] : []
    if (req.url === '/rest/v1/rpc/closed_storefront_branding' && !published) data = { name: 'Krük-Krük', theme: 'paper', accent: '#bdcb20' }
    if (req.url === '/rest/v1/rpc/resolve_store_slug_for_hostname' && body.requested_hostname === 'kruk.example.invalid') data = 'kruk-kruk'
    if (req.url === '/rest/v1/rpc/storefront_seo_document') data = {
      store_name: 'Krük-Krük', store_slug: body.requested_slug, primary_hostname: body.requested_slug === 'other-shop' ? 'other-shop.poeruum.ee' : primaryHost,
      settings: { storeDescription: 'Loodusest inspireeritud Eesti disain.', businessName: 'Krük-Krük OÜ', contactEmail: 'hello@example.invalid' },
      products: [{ id: 'hat', slug: 'nokkmuts', name: 'Nokkmüts', price: 24.42, image_url: '/hat.webp', search_visible: true }],
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const portProbe = createServer()
  portProbe.listen(0, '127.0.0.1')
  await once(portProbe, 'listening')
  const port = portProbe.address().port
  await new Promise(resolve => portProbe.close(resolve))
  const server = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, PORT: String(port), VITE_SUPABASE_URL: `http://127.0.0.1:${backend.address().port}`, VITE_SUPABASE_PUBLISHABLE_KEY: 'test-only' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const visit = (host, path = '/koduleht/', method = 'GET') => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: { Host: host } }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
  try {
    await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Server exited before listening') })])
    const page = await visit(primaryHost)
    assert.equal(page.status, 200)
    assert.equal(page.headers['cache-control'], 'private, no-store')
    assert.match(page.body, /<title>Krük-Krük — lugu ja looming<\/title>/)
    assert.ok(page.body.includes('<link rel="canonical" href="https://kruk-kruk.ee/"'))
    assert.match(page.body, /"@type":"Organization"/)
    assert.match(page.body, /href="mailto:hello@example.invalid"/)
    assert.match(page.body, /Töö mingu metsa\./)
    assert.doesNotMatch(page.body, /"@type":"OnlineStore"/)
    for (const host of ['poeruum.ee', 'www.poeruum.ee']) {
      const redirect = await visit(host, '/p/kruk-kruk/koduleht/?utm_source=test')
      assert.equal(redirect.status, 301)
      assert.equal(redirect.headers.location, `https://${primaryHost}/koduleht/?utm_source=test`)
    }
    const slash = await visit(primaryHost, '/koduleht')
    assert.equal(slash.status, 301)
    assert.equal(slash.headers.location, '/koduleht/')
    const head = await visit(primaryHost, '/koduleht/', 'HEAD')
    assert.equal(head.status, 200)
    assert.equal(head.body, '')
    if (primaryHost !== 'kruk-kruk.poeruum.ee') {
      const redirect = await visit('kruk-kruk.poeruum.ee')
      assert.equal(redirect.headers.location, `https://${primaryHost}/koduleht/`)
    }
    const sitemap = await visit(primaryHost, '/sitemap.xml')
    assert.doesNotMatch(sitemap.body, /\/koduleht\/<\/loc>/)
    assert.match(sitemap.body, /\/toode\/nokkmuts\/<\/loc>/)
    assert.match((await visit(primaryHost, '/')).body, /Krük-Krük – e-pood/)
    assert.match((await visit(primaryHost, '/toode/nokkmuts/')).body, /Nokkmüts – Krük-Krük/)
    assert.equal((await visit('other-shop.poeruum.ee')).status, 404)
    assert.doesNotMatch((await visit('other-shop.poeruum.ee', '/sitemap.xml')).body, /koduleht/)
    const publicPage = await visit('kruk-kruk.ee', '/')
    assert.equal(publicPage.status, 200)
    assert.match(publicPage.body, /Krük-Krük — lugu ja looming/)
    assert.match(publicPage.body, /href="https:\/\/kruk-kruk\.ee\/"/)
    assert.ok(publicPage.body.includes(`href="https://${primaryHost}/"`))
    assert.doesNotMatch(publicPage.body, /name="password"|noindex/)
    assert.equal(publicPage.headers['cache-control'], 'private, no-store')
    assert.equal((await visit('kruk-kruk.ee', '/', 'HEAD')).body, '')
    assert.equal((await visit('www.kruk-kruk.ee', '/?utm_source=test')).headers.location, 'https://kruk-kruk.ee/?utm_source=test')
    assert.equal((await visit('kruk-kruk.ee', '/koduleht/')).headers.location, 'https://kruk-kruk.ee/')
    assert.equal((await visit('kruk-kruk.ee', '/toode/nokkmuts/')).headers.location, `https://${primaryHost}/toode/nokkmuts/`)
    assert.equal((await visit('kruk-kruk.ee', '/api/homepage', 'PUT')).status, 405)
    for (const route of ['/api/homepage', '/eelvaade/kruk-kruk/', '/admin', '/puudub']) assert.equal((await visit('kruk-kruk.ee', route)).status, 404)
    assert.match((await visit('kruk-kruk.ee', '/robots.txt')).body, /Sitemap: https:\/\/kruk-kruk\.ee\/sitemap.xml/)
    const companySitemap = await visit('kruk-kruk.ee', '/sitemap.xml')
    assert.match(companySitemap.body, /<loc>https:\/\/kruk-kruk\.ee\/<\/loc>/)
    assert.doesNotMatch(companySitemap.body, /toode|poeruum/)
    companyHomepage = { heroTitle: 'Uus <lugu>', heroAccent: 'metsast.', heroIntro: 'Muudetud tutvustus.', email: 'madis@example.invalid', heroShop: 'Tutvu loominguga' }
    const edited = await visit(primaryHost)
    assert.match(edited.body, /Uus &lt;lugu&gt; metsast\./)
    assert.match(edited.body, /content="Muudetud tutvustus\."/)
    assert.match(edited.body, /mailto:madis@example.invalid/)
    assert.match(edited.body, /Tutvu loominguga/)
    assert.doesNotMatch(edited.body, /Töö mingu metsa\.|hello@example.invalid/)
    assert.match((await visit('kruk-kruk.ee', '/')).body, /Uus &lt;lugu&gt; metsast\./)
    published = false
    const hidden = await visit(primaryHost)
    assert.match(hidden.body, /Pood on hetkel suletud\./)
    assert.doesNotMatch(hidden.body, /hello@example.invalid|Töö mingu metsa\./)
    assert.match(hidden.headers['x-robots-tag'], /noindex/)
    const hiddenCompany = await visit('kruk-kruk.ee', '/')
    assert.match(hiddenCompany.body, /Pood on hetkel suletud\./)
    assert.doesNotMatch(hiddenCompany.body, /madis@example.invalid|Uus &lt;lugu&gt;/)
    assert.match((await visit('kruk-kruk.ee', '/robots.txt')).body, /Disallow: \//)
    assert.equal((await visit('kruk-kruk.ee', '/sitemap.xml')).status, 404)
    console.log(`Company homepage: ${primaryHost}, SEO, navigation, canonical redirects, sitemap and publication checks passed.`)
  } finally {
    server.kill('SIGTERM')
    await once(server, 'exit')
    await new Promise(resolve => backend.close(resolve))
  }
}

await verify('kruk-kruk.poeruum.ee')
await verify('kruk.example.invalid')
