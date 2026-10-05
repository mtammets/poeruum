import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { once } from 'node:events'

const probe = createServer().listen(0, '127.0.0.1')
await once(probe, 'listening')
const port = probe.address().port
await new Promise((resolve) => probe.close(resolve))
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port), VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
try {
  await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Server exited before listening') })])
  for (const path of ['/admin/campaigns', '/admin/campaigns/', '/campaigns/soundtrack.m4a', '/campaigns/manrope.woff2', '/campaigns/phone-demo.mp4']) {
    const response = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, headers: { Host: 'poeruum.ee' } }, (res) => {
        const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      }); req.on('error', reject); req.end()
    })
    assert.equal(response.status, 200, `${path} must load on the production server`)
    assert.match(response.headers['content-security-policy'], /media-src 'self' blob:/)
    if (path.startsWith('/admin/')) {
      assert.equal(response.headers['cache-control'], 'private, no-store')
      assert.match(response.headers['x-robots-tag'], /noindex/)
      assert.match(response.body.toString(), /id="root"/)
    } else assert.equal(response.headers['content-type'], path.endsWith('.m4a') ? 'audio/mp4' : path.endsWith('.mp4') ? 'video/mp4' : 'font/woff2')
  }
  console.log('Campaign production route, no-index/cache headers, video CSP and asset MIME types passed.')
} finally { server.kill('SIGTERM'); await once(server, 'exit') }
