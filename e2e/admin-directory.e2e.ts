import { expect, test, type Page, type Route } from '@playwright/test'

test.use({ baseURL: 'http://poeruum.localhost:4174' })

const stores = ['Keraamika Stuudio', 'Põhjala Puit', 'Ehtepood'].map((name, index) => ({
  store_id: `10000000-0000-4000-8000-00000000000${index + 1}`,
  store_name: name,
  store_slug: ['keraamika-stuudio', 'pohjala-puit', 'ehtepood'][index],
  products: [],
}))

async function installBackend(page: Page, admin = true) {
  let catalog = [...stores]
  let saveError = ''
  let loadError = false
  const saves: { ordered_store_ids: string[]; expected_store_ids: string[] }[] = []
  const user = {
    id: '20000000-0000-4000-8000-000000000001', email: 'admin@example.invalid',
    aud: 'authenticated', role: 'authenticated',
    app_metadata: admin ? { role: 'admin' } : {}, user_metadata: {}, created_at: '2026-09-01T00:00:00Z',
  }
  const accessToken = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', app_metadata: user.app_metadata, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
    'playwright-signature',
  ].join('.')
  const session = { access_token: accessToken, refresh_token: 'playwright-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  await page.addInitScript((session) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session)), session)
  const json = (route: Route, value: unknown, status = 200) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(value),
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
  })
  await page.route('**/__e2e_supabase/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    } })
    if (path.endsWith('/auth/v1/token')) return json(route, session)
    if (path.endsWith('/auth/v1/user')) return json(route, user)
    if (path.endsWith('/auth/v1/logout')) return json(route, {})
    if (path.endsWith('/rpc/storefront_seo_catalog')) return loadError
      ? json(route, { message: 'Offline' }, 500) : json(route, catalog)
    if (path.endsWith('/rpc/admin_set_store_directory_order')) {
      const body = request.postDataJSON()
      saves.push(body)
      if (saveError) return json(route, { code: saveError, message: 'Save failed' }, saveError === '40001' ? 409 : 500)
      catalog = body.ordered_store_ids.map((id: string) => catalog.find((store) => store.store_id === id)!)
      return json(route, catalog)
    }
    if (path.endsWith('/platform_settings')) return json(route, null)
    return json(route, [])
  })
  return {
    saves,
    failSave: (code: string) => { saveError = code },
    failLoad: (fail: boolean) => { loadError = fail },
    setCatalog: (next: typeof stores) => { catalog = next },
  }
}

const names = (page: Page) => page.locator('.admin-directory__identity strong')

test('admin drags and saves the order, which survives reload and reaches the public directory', async ({ page }) => {
  const backend = await installBackend(page)
  await page.goto('/admin/kaubamaja')
  await expect(page.getByRole('navigation', { name: 'Administraatori menüü' }).getByRole('link', { name: 'Kaubamaja', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(names(page)).toHaveText(stores.map((store) => store.store_name))
  await expect(page.getByRole('button', { name: 'Salvesta järjekord' })).toBeDisabled()
  const rows = page.getByRole('list', { name: 'E-poodide järjekord' }).getByRole('listitem')
  await rows.nth(2).locator('.admin-directory__drag').dragTo(rows.first())
  await expect(names(page)).toHaveText(['Ehtepood', 'Keraamika Stuudio', 'Põhjala Puit'])
  await page.getByRole('button', { name: 'Salvesta järjekord' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Järjekord on salvestatud' })).toBeVisible()
  expect(backend.saves).toEqual([{
    ordered_store_ids: [stores[2].store_id, stores[0].store_id, stores[1].store_id],
    expected_store_ids: stores.map((store) => store.store_id),
  }])
  await page.reload()
  await expect(names(page)).toHaveText(['Ehtepood', 'Keraamika Stuudio', 'Põhjala Puit'])
  await page.screenshot({ path: 'output/admin-directory-desktop.png', fullPage: true })
  await page.goto('http://kaubamaja.poeruum.localhost:4174/')
  await expect(page.locator('.store-directory__card h3').first()).toHaveText('Ehtepood')
  await expect(page.locator('.store-directory__card h3').nth(1)).toHaveText('Keraamika Stuudio')
  await expect(page.locator('.store-directory__card h3').nth(2)).toHaveText('Põhjala Puit')
})

test('mobile keyboard controls, reset, and failed-save retry preserve the draft', async ({ page }) => {
  const backend = await installBackend(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin/kaubamaja')
  await expect(names(page)).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Liiguta Keraamika Stuudio üles' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Liiguta Ehtepood alla' })).toBeDisabled()
  const move = page.getByRole('button', { name: 'Liiguta Põhjala Puit üles' })
  await move.focus()
  await page.keyboard.press('Enter')
  await expect(names(page)).toHaveText(['Põhjala Puit', 'Keraamika Stuudio', 'Ehtepood'])
  await page.getByRole('button', { name: 'Tühista muudatused' }).click()
  await expect(names(page)).toHaveText(stores.map((store) => store.store_name))
  await move.click()
  backend.failSave('XX000')
  await page.getByRole('button', { name: 'Salvesta järjekord' }).click()
  await expect(page.getByRole('alert')).toContainText('ei õnnestunud salvestada')
  await expect(names(page)).toHaveText(['Põhjala Puit', 'Keraamika Stuudio', 'Ehtepood'])
  backend.failSave('')
  await page.getByRole('button', { name: 'Salvesta järjekord' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Järjekord on salvestatud' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  expect((await move.boundingBox())?.width).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: 'output/admin-directory-mobile.png', fullPage: true })
})

test('conflicting changes require loading the current order before another save', async ({ page }) => {
  const backend = await installBackend(page)
  await page.goto('/admin/kaubamaja')
  await page.getByRole('button', { name: 'Liiguta Ehtepood üles' }).click()
  backend.failSave('40001')
  backend.setCatalog([stores[1], stores[2], stores[0]])
  await page.getByRole('button', { name: 'Salvesta järjekord' }).click()
  await expect(page.getByRole('alert')).toContainText('vahepeal muutunud')
  await expect(page.getByRole('button', { name: 'Salvesta järjekord' })).toBeDisabled()
  await page.getByRole('button', { name: 'Laadi salvestatud järjekord' }).click()
  await expect(names(page)).toHaveText(['Põhjala Puit', 'Ehtepood', 'Keraamika Stuudio'])
  backend.failSave('')
  await page.getByRole('button', { name: 'Liiguta Ehtepood üles' }).click()
  await page.getByRole('button', { name: 'Salvesta järjekord' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Järjekord on salvestatud' })).toBeVisible()
  expect(backend.saves[1].expected_store_ids).toEqual([stores[1].store_id, stores[2].store_id, stores[0].store_id])
})

test('load failures can be retried and an empty directory cannot be saved', async ({ page }) => {
  const backend = await installBackend(page)
  backend.failLoad(true)
  await page.goto('/admin/kaubamaja')
  await expect(page.getByRole('alert')).toContainText('Poode ei õnnestunud laadida')
  await expect(page.getByRole('button', { name: 'Salvesta järjekord' })).toBeDisabled()
  backend.failLoad(false)
  backend.setCatalog([])
  await page.getByRole('button', { name: 'Uuenda loendit' }).click()
  await expect(page.getByText('Kaubamajas pole veel avaldatud e-poode.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Salvesta järjekord' })).toBeDisabled()
})

test('a merchant cannot open the directory administration', async ({ page }) => {
  await installBackend(page, false)
  await page.goto('/admin/kaubamaja')
  await expect(page.getByText('Sellel kontol puudub administraatori ligipääs.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Salvesta järjekord' })).toHaveCount(0)
})
