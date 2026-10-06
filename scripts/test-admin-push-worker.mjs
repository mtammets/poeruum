import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { once } from 'node:events'

const handlers = new Map(), notifications = [], opened = []
let windows = [], focused = false, navigated = '', closed = false
const worker = {
  location: { origin: 'https://poeruum.ee' },
  addEventListener: (name, handler) => handlers.set(name, handler), skipWaiting: async () => {},
  registration: { showNotification: async (title, options) => { notifications.push({ title, options }) } },
  clients: { claim: async () => {}, matchAll: async () => windows, openWindow: async (url) => { opened.push(url) } },
}
runInNewContext(await readFile('public/admin-push-sw.js', 'utf8'), { self: worker, URL })
const dispatch = async (name, properties) => {
  let work
  handlers.get(name)({ ...properties, waitUntil: (promise) => { work = promise } })
  await work
}
await dispatch('push', { data: { json: () => ({ title: 'Uus konto', body: 'Test', tag: 'unique-event', url: 'https://evil.invalid' }) } })
assert.equal(notifications.length, 1, 'Push must display with no open windows')
assert.equal(notifications[0].title, 'Uus konto')
assert.equal(notifications[0].options.data.url, '/admin', 'Notification cannot open an external URL')
await dispatch('push', { data: { json: () => { throw new Error('Malformed payload') } } })
assert.equal(notifications.length, 2, 'Every push must create a visible notification, even malformed data')
const notification = { close: () => { closed = true }, data: { url: 'https://evil.invalid' } }
await dispatch('notificationclick', { notification })
assert.equal(opened[0], '/admin'); assert.ok(closed)
windows = [{ url: 'https://poeruum.ee/admin/users', navigate: async (url) => { navigated = url }, focus: async () => { focused = true } }]
await dispatch('notificationclick', { notification })
assert.equal(navigated, '/admin'); assert.ok(focused); assert.equal(opened.length, 1)
assert.ok(!handlers.has('fetch'), 'Admin responses must not be cached by the worker')

const probe = createServer().listen(0, '127.0.0.1')
await once(probe, 'listening')
const port = probe.address().port
await new Promise((resolve) => probe.close(resolve))
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port), VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
try {
  await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Server failed to start') })])
  for (const path of ['/admin/settings', '/admin/settings/', '/admin-push-sw.js', '/admin.webmanifest', '/images/admin-icon-192.png', '/images/admin-icon-512.png']) {
    const response = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, headers: { Host: 'poeruum.ee' } }, (res) => {
        const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      }); req.on('error', reject); req.end()
    })
    assert.equal(response.status, 200, `${path} must be served in production`)
    if (path.startsWith('/admin/settings')) {
      assert.match(response.headers['content-type'], /text\/html/)
      assert.equal(response.headers['cache-control'], 'private, no-store')
      assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow')
    } else if (path.endsWith('.js')) {
      assert.match(response.headers['content-type'], /javascript/)
      assert.equal(response.headers['cache-control'], 'no-cache')
      assert.match(response.body.toString(), /notificationclick/)
    } else if (path.endsWith('.webmanifest')) {
      assert.match(response.headers['content-type'], /application\/manifest\+json/)
      const manifest = JSON.parse(response.body)
      assert.equal(manifest.start_url, '/admin'); assert.equal(manifest.display, 'standalone')
    } else assert.equal(response.headers['content-type'], 'image/png')
  }
} finally { server.kill('SIGTERM'); await once(server, 'exit') }
console.log('Push worker without open pages, click handling and production assets passed.')
