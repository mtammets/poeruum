import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { once } from 'node:events'

let published = false
let seoRequests = 0
const branding = { name: 'Suletud pood', logo: '/images/poeruum-email-logo.svg', theme: 'paper', accent: '#cc6633' }
const backend = createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw || '{}')
  let data = null
  if (req.url === '/rest/v1/rpc/closed_storefront_branding') {
    if (!published && (body.requested_slug === 'closed-shop' || ['closed.example.invalid', 'www.closed.example.invalid'].includes(body.requested_hostname))) data = branding
  } else if (req.url === '/rest/v1/rpc/storefront_seo_document') {
    seoRequests += 1
    if (published && body.requested_slug === 'closed-shop') data = {
      store_name: branding.name, store_slug: 'closed-shop', primary_hostname: 'closed-shop.poeruum.ee', settings: { storeDescription: 'Poe täielik tutvustus' },
      products: [{ id: 'product', slug: 'toode', name: 'Poe toode', description: 'Toote detailid', price: 20, image_url: '/product.jpg', search_visible: true }],
    }
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
await new Promise((resolve) => portProbe.close(resolve))
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), VITE_SUPABASE_URL: `http://127.0.0.1:${backend.address().port}`, VITE_SUPABASE_PUBLISHABLE_KEY: 'test-only' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const visit = (host, path = '/', method = 'GET') => new Promise((resolve, reject) => {
  const req = request({ hostname: '127.0.0.1', port, path, method, headers: { Host: host } }, (res) => {
    let body = ''
    res.on('data', (chunk) => { body += chunk })
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
  })
  req.on('error', reject)
  req.end()
})
const assertClosed = (response) => {
  assert.equal(response.status, 200)
  assert.match(response.headers['content-type'], /text\/html/)
  assert.equal(response.headers['cache-control'], 'private, no-store')
  assert.match(response.headers['x-robots-tag'], /noindex/)
  assert.match(response.body, /Pood on hetkel suletud\./)
  assert.match(response.body, /data-store-theme="paper"/)
  assert.match(response.body, /--closed-accent:#cc6633/)
  assert.doesNotMatch(response.body, /Poe toode|Toote detailid|Poe täielik tutvustus|Loodud Poeruumis|id="root"/)
}
try {
  await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Server exited before listening') })])
  for (const [host, path] of [
    ['closed-shop.poeruum.ee', '/'], ['closed-shop.poeruum.ee', '/toode/toode/'],
    ['poeruum.ee', '/p/closed-shop/'], ['poeruum.ee', '/?store=closed-shop'],
    ['closed.example.invalid', '/'], ['www.closed.example.invalid', '/toode/toode/'],
  ]) assertClosed(await visit(host, path))
  assert.equal(seoRequests, 0, 'Hidden storefronts must not fetch product/SEO content')
  const head = await visit('closed-shop.poeruum.ee', '/', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.body, '')
  assert.match((await visit('closed-shop.poeruum.ee', '/robots.txt')).body, /Disallow: \//)
  assert.equal((await visit('closed-shop.poeruum.ee', '/sitemap.xml')).status, 404)
  assert.match((await visit('closed-shop.poeruum.ee', '/closed-storefront.js')).headers['content-type'], /javascript/)
  const missing = await visit('missing-shop.poeruum.ee')
  assert.equal(missing.status, 404)
  assert.doesNotMatch(missing.body, /hetkel suletud/)
  for (const path of ['/haldus', '/?stripe_connect=return', '/?checkout=status']) {
    const shell = await visit('closed-shop.poeruum.ee', path)
    assert.equal(shell.status, 200)
    assert.match(shell.body, /id="root"/)
    assert.doesNotMatch(shell.body, /closed-store__message/)
  }
  published = true
  const openStore = await visit('closed-shop.poeruum.ee')
  assert.match(openStore.body, /Poe toode/)
  assert.equal(openStore.headers['cache-control'], 'private, no-store', 'A shared HTML cache must not bypass the publication check')
  published = false
  assertClosed(await visit('closed-shop.poeruum.ee'))
  published = true
  assert.match((await visit('closed-shop.poeruum.ee')).body, /Poe toode/)
  console.log('Closed storefront: branding, private content, fresh publication state, domains, product links and management/receipt access passed.')
} finally {
  server.kill('SIGTERM')
  await once(server, 'exit')
  await new Promise((resolve) => backend.close(resolve))
}
