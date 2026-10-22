import { expect, test, type Page } from '@playwright/test'

test.use({ baseURL: 'http://poeruum.localhost:4174' })
const initial = { mode: 'off', startsAt: null as string | null, endsAt: null as string | null, revision: 0, serverNow: '2026-10-22T09:00:00Z' }
async function backend(page: Page) {
  let campaign = { ...initial }
  let fail = ''
  let unavailable = false
  const saves: Record<string, unknown>[] = []
  const user = { id: '20000000-0000-4000-8000-000000000001', email: 'admin@example.invalid',
    aud: 'authenticated', role: 'authenticated', app_metadata: { role: 'admin' }, user_metadata: {}, created_at: '2026-09-01T00:00:00Z' }
  const access = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', app_metadata: user.app_metadata, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'test-signature'].join('.')
  const session = { access_token: access, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  await page.addInitScript(value => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(value)), session)
  await page.route('**/__e2e_supabase/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data),
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } })
    if (path.endsWith('/auth/v1/token')) return json(session)
    if (path.endsWith('/auth/v1/user')) return json(user)
    if (path.endsWith('/platform_settings')) return json(null)
    if (path.endsWith('/rpc/get_directory_campaign')) return unavailable ? json({ message: 'offline' }, 503) : json(campaign)
    if (path.endsWith('/rpc/admin_set_directory_campaign')) {
      const body = request.postDataJSON()
      saves.push(body)
      if (fail) return json({ code: fail }, 409)
      campaign = { ...campaign, mode: body.next_mode, startsAt: body.next_starts_at, endsAt: body.next_ends_at, revision: campaign.revision + 1 }
      return json(campaign)
    }
    return json([])
  })
  return { saves, fail: (code: string) => { fail = code }, unavailable: () => { unavailable = true },
    set: (value: Partial<typeof initial>) => { campaign = { ...campaign, ...value } } }
}

test('admin saves on, off and an Estonian schedule; state survives reload', async ({ page }) => {
  const api = await backend(page)
  await page.goto('/admin/kaubamaja?view=campaign')
  await expect(page.getByRole('radio', { name: /^Väljas/ })).toBeChecked()
  await page.getByRole('radio', { name: /^Kohe sees/ }).check()
  await page.getByRole('button', { name: 'Salvesta kampaania' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'sisse lülitatud' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('radio', { name: /^Kohe sees/ })).toBeChecked()
  await page.getByRole('radio', { name: /^Ajastatud/ }).check()
  await page.getByLabel('Algusaeg').fill('2026-11-27T08:00')
  await page.getByLabel('Lõpuaeg').fill('2026-12-01T00:00')
  await page.getByRole('button', { name: 'Salvesta kampaania' }).click()
  await expect(page.getByText('Ootab algusaega')).toBeVisible()
  expect(api.saves[1]).toEqual({ next_mode: 'scheduled', next_starts_at: '2026-11-27T06:00:00.000Z', next_ends_at: '2026-11-30T22:00:00.000Z', expected_revision: 1 })
  await page.screenshot({ path: 'output/directory-campaign-admin.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'output/directory-campaign-admin-mobile.png', fullPage: true })
  await page.getByRole('radio', { name: /^Väljas/ }).check()
  await page.getByRole('button', { name: 'Salvesta kampaania' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'välja lülitatud' })).toBeVisible()
})

test('invalid intervals and conflicting saves preserve the draft', async ({ page }) => {
  const api = await backend(page)
  await page.goto('/admin/kaubamaja?view=campaign')
  await page.getByRole('radio', { name: /^Ajastatud/ }).check()
  await page.getByLabel('Algusaeg').fill('2026-11-27T08:00')
  await page.getByLabel('Lõpuaeg').fill('2026-11-26T08:00')
  await page.getByRole('button', { name: 'Salvesta kampaania' }).click()
  await expect(page.getByRole('alert')).toContainText('hilisem')
  expect(api.saves).toHaveLength(0)
  await page.getByLabel('Lõpuaeg').fill('2026-11-30T08:00')
  api.fail('40001')
  await page.getByRole('button', { name: 'Salvesta kampaania' }).click()
  await expect(page.getByRole('alert')).toContainText('vahepeal muutunud')
  await expect(page.getByLabel('Algusaeg')).toHaveValue('2026-11-27T08:00')
  await expect(page.getByRole('button', { name: 'Salvesta kampaania' })).toBeDisabled()
  await page.getByRole('button', { name: 'Laadi salvestatud seadistus' }).click()
  await expect(page.getByRole('radio', { name: /^Väljas/ })).toBeChecked()
})

test('public campaign starts and ends on server time without reloading', async ({ page }) => {
  const api = await backend(page)
  // The visitor's wall clock is deliberately years out of date.
  await page.clock.install({ time: new Date('2032-01-01T00:00:00Z') })
  api.set({ mode: 'scheduled', startsAt: '2026-10-22T09:00:05Z', endsAt: '2026-10-22T09:00:10Z' })
  await page.goto('http://kaubamaja.poeruum.localhost:4174/')
  const root = page.locator('main.store-directory')
  await expect(root).toHaveAttribute('data-directory-theme', 'default')
  await page.clock.runFor(5100)
  await expect(root).toHaveAttribute('data-directory-theme', 'black-friday')
  await page.clock.runFor(5000)
  await expect(root).toHaveAttribute('data-directory-theme', 'default')
})

test('manual changes reach open pages and unavailable configuration fails closed', async ({ page }) => {
  const api = await backend(page)
  await page.clock.install()
  api.set({ mode: 'on' })
  await page.goto('http://kaubamaja.poeruum.localhost:4174/')
  const root = page.locator('main.store-directory')
  await expect(root).toHaveAttribute('data-directory-theme', 'black-friday')
  api.set({ mode: 'off' })
  await page.clock.runFor(30100)
  await expect(root).toHaveAttribute('data-directory-theme', 'default')
  api.set({ mode: 'on' })
  await page.clock.runFor(30100)
  await expect(root).toHaveAttribute('data-directory-theme', 'black-friday')
  api.unavailable()
  await page.clock.runFor(30100)
  await expect(root).toHaveAttribute('data-directory-theme', 'default')
})

test('ending a campaign preserves an open checkout until the buyer closes it', async ({ page }) => {
  const api = await backend(page)
  await page.clock.install()
  api.set({ mode: 'on' })
  const id = '10000000-0000-4000-8000-000000000001'
  const product = { id: 'cap', name: 'Nokkmüts', slug: 'nokkmuts', price: 19.9, image_url: 'http://localhost:4174/storage/v1/object/public/product-images/cap.webp', stock: 5, search_visible: true }
  await page.route('**/storage/v1/object/public/product-images/cap.webp', route => route.fulfill({ path: 'public/images/campaigns/kruk-cap-cutout-v1.webp' }))
  await page.route('**/rest/v1/rpc/storefront_seo_catalog', route => route.fulfill({ json: [{ store_id: id, store_name: 'Krük-Krük', store_slug: 'kruk-kruk', products: [product] }] }))
  await page.route('**/rest/v1/public_storefronts?*', route => route.fulfill({ json: {
    id, name: 'Krük-Krük', slug: 'kruk-kruk', is_published: true, payment_provider: 'stripe', payment_status: 'connected',
    settings: { deliverySettings: { parcelProviders: { omniva: { enabled: false, price: 0 }, dpd: { enabled: true, price: 2.9 }, smartposti: { enabled: false, price: 0 } },
      courierEnabled: false, courierPrice: 0, pickupEnabled: false, pickupAddress: '', freeShippingFrom: 50 } },
  } }))
  await page.route('**/rest/v1/products?*', route => route.fulfill({ json: [product] }))
  await page.goto('http://kaubamaja.poeruum.localhost:4174/')
  await page.locator('.kruk-store-card__buy').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  api.set({ mode: 'off' })
  await page.clock.runFor(30100)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('main.store-directory')).toHaveAttribute('data-directory-theme', 'default')
})
