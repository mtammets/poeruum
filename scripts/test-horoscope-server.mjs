import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { zodiacSigns } from '../supabase/functions/_shared/zodiac.mjs'

const probe = createServer().listen(0, '127.0.0.1')
await once(probe, 'listening')
const port = probe.address().port
await new Promise((resolve) => probe.close(resolve))
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const fetchPage = (path, method = 'GET') => new Promise((resolve, reject) => {
  const req = request({ hostname: '127.0.0.1', port, path, method, headers: {
    Host: 'kaubamaja.poeruum.ee', 'User-Agent': 'facebookexternalhit/1.1',
  } }, (res) => {
    const chunks = []
    res.on('data', (chunk) => chunks.push(chunk))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
  })
  req.on('error', reject)
  req.end()
})
const meta = (html, property) => html.match(new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)"`))?.[1]

try {
  await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Server exited before listening') })])
  for (const sign of zodiacSigns) {
    const response = await fetchPage(`/?horoskoop=${sign.id}&utm_source=ignored`)
    assert.equal(response.status, 200)
    const html = response.body.toString()
    const expectedTitle = `${sign.name} · tänane horoskoop — Poeruumi Kaubamaja`
    assert.equal(meta(html, 'og:title'), expectedTitle)
    assert.equal(meta(html, 'twitter:title'), expectedTitle)
    assert.equal(meta(html, 'og:url'), `https://kaubamaja.poeruum.ee/?horoskoop=${sign.id}`)
    assert.equal(meta(html, 'og:image:width'), '1200')
    assert.equal(meta(html, 'og:image:height'), '630')
    assert.equal(meta(html, 'og:image:type'), 'image/png')
    assert.equal(meta(html, 'twitter:card'), 'summary_large_image')
    assert.equal(meta(html, 'og:description'), 'Loe oma tänast horoskoopi Poeruumi Kaubamajas.')
    assert.ok(html.includes('<link rel="canonical" href="https://kaubamaja.poeruum.ee/"'))
    assert.ok(html.includes('Leia oma uus lemmikpood'))
    const imageUrl = meta(html, 'og:image')
    assert.equal(imageUrl, `https://kaubamaja.poeruum.ee/images/horoscope/${sign.id}.png`)
    assert.equal(meta(html, 'twitter:image'), imageUrl)
    const image = await fetchPage(new URL(imageUrl).pathname)
    assert.equal(image.status, 200)
    assert.equal(image.headers['content-type'], 'image/png')
    assert.equal(image.body.subarray(1, 4).toString(), 'PNG')
    assert.equal(image.body.readUInt32BE(16), 1200)
    assert.equal(image.body.readUInt32BE(20), 630)
  }
  for (const path of ['/', '/?horoskoop=invalid', '/?horoskoop=__proto__', '/?horoskoop=%22%3E%3Cscript%3E']) {
    const response = await fetchPage(path)
    assert.equal(response.status, 200)
    assert.equal(meta(response.body.toString(), 'og:url'), 'https://kaubamaja.poeruum.ee/')
    assert.equal(meta(response.body.toString(), 'og:title'), 'Poeruumi Kaubamaja – avasta Eesti väikeettevõtjate e-poode')
  }
  const head = await fetchPage('/?horoskoop=gemini', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.body.length, 0)
  console.log('Horoscope previews: all 12 signs, crawler-visible metadata, PNG assets, canonical URLs and invalid signs passed.')
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM')
    await once(server, 'exit')
  }
}
