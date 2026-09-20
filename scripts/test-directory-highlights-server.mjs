import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { once } from 'node:events'

// Verify the actual production HTML, including when JavaScript is unavailable.
const catalog = [10, 1, 1, 1].map((count, index) => ({
  store_id: `store-${index}`, store_name: `Pood ${index}`, store_slug: `pood-${index}`,
  primary_hostname: index === 1 ? 'custom.example.ee' : undefined,
  products: [
    { id: 'sold-out', name: 'Välja müüdud', stock: 0, image_url: '/sold.webp', price: 5 },
    ...Array.from({ length: count }, (_, productIndex) => ({
      id: `product-${index}-${productIndex}`, name: index === 1 ? 'Kruus <sinine> & "ilus"' : `Toode ${index}.${productIndex}`,
      slug: `toode-${productIndex}`, image_url: '/product.webp', price: 30, sale_price: index === 1 ? 24 : null, stock: 1,
    })),
  ],
}))

for (const records of [catalog, []]) {
  const backend = createServer((req, res) => {
    if (req.url !== '/rest/v1/rpc/storefront_seo_catalog') {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(records))
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const portProbe = createServer()
  portProbe.listen(0, '127.0.0.1')
  await once(portProbe, 'listening')
  const port = portProbe.address().port
  await new Promise((resolve) => portProbe.close(resolve))
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port),
    VITE_SUPABASE_URL: `http://127.0.0.1:${backend.address().port}`, VITE_SUPABASE_PUBLISHABLE_KEY: 'test-only' }, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Server exited before listening') })])
    const response = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/', headers: { Host: 'kaubamaja.poeruum.ee' } }, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => resolve({ status: res.statusCode, body }))
      })
      req.on('error', reject)
      req.end()
    })
    assert.equal(response.status, 200)
    const html = response.body
    const section = html.match(/<section class="store-directory__highlights"[\s\S]*?<\/section>/)?.[0]
    if (records.length === 0) {
      assert.equal(section, undefined)
      continue
    }
    assert.ok(section)
    assert.equal(section.match(/<article /g)?.length, 8)
    assert.equal(section.match(/<img /g)?.length, 8)
    assert.deepEqual([...section.matchAll(/class="store-directory__product-store">(.*?)<\/span>/g)].map((match) => match[1]), ['Pood 0', 'Pood 1', 'Pood 2', 'Pood 3', 'Pood 0', 'Pood 0', 'Pood 0', 'Pood 0'])
    assert.ok(section.includes('https://custom.example.ee/toode/toode-0/?from=kaubamaja'))
    assert.ok(section.includes('<strong>24 €</strong><del>30 €</del>'))
    assert.ok(section.includes('Kruus &lt;sinine&gt; &amp; &quot;ilus&quot;'))
    assert.ok(!section.includes('Välja müüdud'))
    assert.ok(html.indexOf(section) < html.indexOf('<section class="store-directory__stores"'))
  } finally {
    if (server.exitCode === null) {
      server.kill('SIGTERM')
      await once(server, 'exit')
    }
    await new Promise((resolve) => backend.close(resolve))
  }
}
console.log('Production directory highlights: balanced selection, direct links, prices, escaped content and empty catalog passed.')
