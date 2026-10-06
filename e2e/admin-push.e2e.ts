import { expect, test, type Page } from '@playwright/test'
test.use({ baseURL: 'http://poeruum.localhost:4174' })

async function backend(page: Page, options: { failSave?: boolean; denied?: boolean; iphone?: boolean } = {}) {
  const user = { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { role: 'admin' }, user_metadata: {}, created_at: new Date().toISOString() }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', app_metadata: user.app_metadata, exp })).toString('base64url'), 'fixture'].join('.')
  const session = { user, access_token: token, refresh_token: 'fixture', expires_at: exp, expires_in: 3600, token_type: 'bearer' }
  const actions: string[] = []
  let saved = false
  await page.addInitScript(({ session, options }) => {
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session))
    if (options.iphone) Object.defineProperty(navigator, 'userAgent', { value: 'iPhone' })
    let subscribed = localStorage.getItem('push-fixture') === 'yes'
    const subscription = {
      endpoint: 'https://web.push.apple.com/fixture',
      toJSON: () => ({ endpoint: 'https://web.push.apple.com/fixture', keys: { auth: 'a'.repeat(22), p256dh: 'b'.repeat(87) } }),
      unsubscribe: async () => { subscribed = false; localStorage.removeItem('push-fixture'); return true },
    }
    const worker = { pushManager: {
      getSubscription: async () => subscribed ? subscription : null,
      subscribe: async () => { subscribed = true; localStorage.setItem('push-fixture', 'yes'); return subscription },
    } }
    Object.defineProperty(window, 'Notification', { value: { permission: options.denied ? 'denied' : 'granted', requestPermission: async () => options.denied ? 'denied' : 'granted' } })
    Object.defineProperty(window, 'PushManager', { value: class {} })
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: async () => worker, ready: Promise.resolve(worker), getRegistration: async () => worker } })
  }, { session, options })
  await page.route('**/__e2e_supabase/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/v1/user')) return route.fulfill({ json: user })
    if (path.endsWith('/auth/v1/token')) return route.fulfill({ json: session })
    if (path.endsWith('/admin-push')) {
      const body = route.request().postDataJSON(); actions.push(body.action)
      if (body.action === 'config') return route.fulfill({ json: { available: true, publicKey: 'B'.repeat(87) } })
      if (body.action === 'subscribe') {
        if (options.failSave) return route.fulfill({ status: 503, json: { error: 'Märguannete salvestamine ebaõnnestus.' } })
        saved = true
      }
      if (body.action === 'unsubscribe') saved = false
      return route.fulfill({ json: body.action === 'test' ? { sent: true } : { enabled: saved } })
    }
    if (path.endsWith('/admin_homepage_analytics')) return route.fulfill({ json: { range_days: 30, sessions: 822, accounts_created: 10, daily: [] } })
    if (path.endsWith('/platform_settings')) return route.fulfill({ json: null })
    return route.fulfill({ json: [] })
  })
  return actions
}

test('admin enables, tests, restores and disables this device’s notifications', async ({ page }) => {
  const actions = await backend(page)
  await page.goto('/admin')
  const toggle = page.getByRole('button', { name: 'Telefoni märguanded' })
  await expect(toggle).toBeEnabled()
  await expect(toggle).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Külastuste ja uute kontode heli' })).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Proovi', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Prooviteavitus on saadetud' })).toBeVisible()
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('link', { name: 'Ava külastatavuse üksikasjad' }).click()
  await expect(toggle).toHaveCount(1)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Külastuste ja uute kontode heli' })).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(actions).toContain('subscribe'); expect(actions).toContain('test'); expect(actions).toContain('unsubscribe')
  expect(await page.evaluate(() => localStorage.getItem('push-fixture'))).toBeNull()
})

test('iPhone browser explains Home Screen install without requesting permission', async ({ page }, testInfo) => {
  const actions = await backend(page, { iphone: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin')
  await page.getByRole('button', { name: 'Telefoni märguanded' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Lisa avaekraanile' })).toBeVisible()
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/admin.webmanifest')
  expect(actions).not.toContain('subscribe')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('admin-push-iphone.png'), fullPage: true })
})

test('failed saves roll back the browser subscription', async ({ page }) => {
  await backend(page, { failSave: true })
  await page.goto('/admin')
  const toggle = page.getByRole('button', { name: 'Telefoni märguanded' })
  await expect(toggle).toBeEnabled(); await toggle.click()
  await expect(page.getByRole('alert').filter({ hasText: 'salvestamine ebaõnnestus' })).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => localStorage.getItem('push-fixture'))).toBeNull()
})

test('denied notification permission points to system settings', async ({ page }) => {
  const actions = await backend(page, { denied: true })
  await page.goto('/admin')
  await page.getByRole('button', { name: 'Telefoni märguanded' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Märguanded on keelatud' })).toBeVisible()
  expect(actions).not.toContain('subscribe')
})

test('admin logout removes this device’s subscription', async ({ page }) => {
  const actions = await backend(page)
  await page.goto('/admin')
  const toggle = page.getByRole('button', { name: 'Telefoni märguanded' })
  await expect(toggle).toBeEnabled(); await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Logi välja', exact: true }).click()
  await expect(page).toHaveURL('http://poeruum.localhost:4174/')
  expect(actions).toContain('unsubscribe')
  expect(await page.evaluate(() => localStorage.getItem('push-fixture'))).toBeNull()
})
