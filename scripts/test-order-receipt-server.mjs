import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { once } from 'node:events'

// Exercise the production HTTP server, not Vite's SPA fallback. An unavailable
// backend ensures receipt shells never depend on publication or SEO redirects.
const portProbe = createServer()
portProbe.listen(0, '127.0.0.1')
await once(portProbe, 'listening')
const port = portProbe.address().port
await new Promise((resolve) => portProbe.close(resolve))
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port),
  VITE_SUPABASE_URL: 'http://127.0.0.1:1', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-only' }, stdio: ['ignore', 'pipe', 'pipe'] })
try {
  await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Server exited before listening') })])
  for (const [host, path] of [['poeruum.ee', '/p/closed-shop?checkout=status'], ['closed-shop.poeruum.ee', '/?checkout=status'],
    ['custom-shop.example.invalid', '/?checkout=status'], ['poeruum.ee', '/p/old-shop?checkout=success&session_id=private-test-session']]) {
    const response = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
        let body = ''; res.on('data', (chunk) => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
      }); req.on('error', reject); req.end()
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.location, undefined)
    assert.equal(response.headers['cache-control'], 'private, no-store')
    assert.equal(response.headers['referrer-policy'], 'no-referrer')
    assert.match(response.headers['x-robots-tag'], /noindex/)
    assert.match(response.body, /id="root"/)
    assert.match(response.body, /<title>Tellimuse ülevaade<\/title>/)
    assert.ok(!response.body.includes('private-test-session'))
  }
  console.log('Production receipt routing: platform path, subdomain, custom domain and legacy return passed.')
} finally { server.kill('SIGTERM'); await once(server, 'exit') }
