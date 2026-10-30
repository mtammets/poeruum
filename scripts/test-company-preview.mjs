import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomBytes, scryptSync } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { createReviewServer } from '../previews/company-homepage/server.mjs'

const password = 'test-only-review-password'
const salt = randomBytes(16).toString('hex')
const passwordHash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`

async function fixture(assets, basePath = '/') {
  let copy = {}, revision = 1, writes = 0
  const server = createReviewServer({ passwordHash, sessionSecret: randomBytes(32).toString('hex'), secureCookies: false, assets, basePath,
    load: async () => ({
      store: { id: 'review-shop', name: 'Krük-Krük', slug: 'kruk-kruk', is_published: true, shipping: [], settings: { companyHomepage: copy, contactEmail: 'madis@example.invalid' } },
      products: [{ id: 'hat', slug: 'nokkmuts', name: 'Nokkmüts', price: 25, image: '/images/campaigns/kruk-cap-cutout-v1.webp' }], revision, shopUrl: 'https://kruk-kruk.poeruum.ee/',
    }),
    save: async (value, expected) => {
      if (revision !== expected) throw Object.assign(new Error('Tekste on vahepeal muudetud.'), { status: 409 })
      copy = value; revision += 1; writes += 1
      return { revision }
    },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  return { origin, server, writes: () => writes, close: () => new Promise(resolve => server.close(resolve)) }
}

test('password protects content, assets and editing; sessions, CSRF and conflicts are enforced', async () => {
  const assets = await mkdtemp(path.join(tmpdir(), 'kruk-review-'))
  await writeFile(path.join(assets, 'index.html'), '<h1>PRIVATE CONTENT</h1>')
  await writeFile(path.join(assets, 'private.js'), 'PRIVATE_SCRIPT')
  const app = await fixture(assets)
  const visit = (route, options) => fetch(`${app.origin}${route}`, { redirect: 'manual', ...options })
  try {
    for (const route of ['/', '/private.js', '/api/homepage', '/?edit=1']) {
      const response = await visit(route)
      assert.equal(response.status, 401)
      assert.match(response.headers.get('cache-control'), /no-store/)
      assert.match(response.headers.get('x-robots-tag'), /noindex/)
      assert.doesNotMatch(await response.text(), /PRIVATE_CONTENT|PRIVATE CONTENT|PRIVATE_SCRIPT/)
    }
    assert.equal((await visit('/login', { method: 'POST', body: `password=${password}` })).status, 403)
    assert.equal((await visit('/login', { method: 'POST', headers: { Origin: app.origin }, body: 'password=wrong' })).status, 401)
    const signedIn = await visit('/login', { method: 'POST', headers: { Origin: app.origin }, body: `password=${password}` })
    assert.equal(signedIn.status, 303)
    const cookie = signedIn.headers.get('set-cookie')
    assert.match(cookie, /HttpOnly; SameSite=Strict/)
    const auth = { Cookie: cookie.split(';')[0] }
    assert.equal((await visit('/', { headers: auth })).status, 200)
    assert.equal((await visit('/private.js', { headers: auth })).status, 200)
    assert.equal((await visit('/', { headers: { Cookie: `${auth.Cookie}tampered` } })).status, 401)
    assert.equal((await visit('/api/homepage', { method: 'PUT', headers: { ...auth, Origin: 'https://evil.invalid', 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
    const put = body => visit('/api/homepage', { method: 'PUT', headers: { ...auth, Origin: app.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await put({ revision: 1, copy: { unknown: 'x' } })).status, 400)
    assert.equal((await put({ revision: 1, copy: { heroTitle: 'x'.repeat(101) } })).status, 400)
    assert.equal((await put({ revision: 1, copy: { email: 'invalid' } })).status, 400)
    assert.equal((await put({ revision: 1, copy: { heroTitle: 'Uus tekst' } })).status, 200)
    assert.equal((await put({ revision: 1, copy: { heroTitle: 'Vana versioon' } })).status, 409)
    assert.equal((await (await visit('/api/homepage', { headers: auth })).json()).store.settings.companyHomepage.heroTitle, 'Uus tekst')
    assert.equal(app.writes(), 1)
    assert.equal((await visit('/.env', { headers: auth })).status, 404)
    const logout = await visit('/logout', { method: 'POST', headers: { ...auth, Origin: app.origin } })
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/)
    for (let i = 0; i < 29; i += 1) await visit('/login', { method: 'POST', headers: { Origin: app.origin }, body: 'password=wrong' })
    assert.equal((await visit('/login', { method: 'POST', headers: { Origin: app.origin }, body: `password=${password}` })).status, 429)
  } finally { await app.close(); await rm(assets, { recursive: true, force: true }) }
})

test('client can sign in, edit, save across browsers and sign out', async () => {
  const basePath = '/eelvaade/kruk-kruk/'
  const app = await fixture(path.resolve('dist-company-preview'), basePath)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${app.origin}${basePath}`)
    await page.getByLabel('Parool').fill(password)
    await page.getByRole('button', { name: 'Ava koduleht' }).click()
    await page.getByRole('button', { name: 'Muuda', exact: true }).click()
    await page.getByRole('textbox', { name: 'Pealkirja esimene rida', exact: true }).fill('Kliendi uus tekst')
    await page.getByRole('button', { name: 'Salvesta', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Muudatused on salvestatud.' }).waitFor()
    await page.getByRole('button', { name: 'Valmis', exact: true }).click()
    assert.equal(await page.getByRole('link', { name: 'Vaata toodet e-poes' }).getAttribute('href'), 'https://kruk-kruk.poeruum.ee/toode/nokkmuts/')
    const second = await browser.newPage()
    await second.goto(`${app.origin}${basePath}`)
    await second.getByLabel('Parool').fill(password)
    await second.getByRole('button', { name: 'Ava koduleht' }).click()
    await second.getByRole('heading', { name: 'Kliendi uus tekst metsa.' }).waitFor()
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false)
    await page.getByRole('button', { name: 'Välju', exact: true }).click()
    await page.getByLabel('Parool').waitFor()
    assert.equal((await page.request.get(`${app.origin}${basePath}api/homepage`)).status(), 401)
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await app.close() }
})
