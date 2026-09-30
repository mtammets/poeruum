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
  let showcase = {
    selectedStoreIds: [stores[0].store_id, stores[1].store_id],
    stores: stores.map((store, index) => ({ id: store.store_id, name: store.store_name, slug: store.store_slug, isPublished: index !== 2, eligibleProductCount: index === 1 ? 0 : 2 })),
  }
  const showcaseSaves: unknown[] = []
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
    if (path.endsWith('/rpc/admin_homepage_showcase')) return loadError
      ? json(route, { message: 'Offline' }, 500) : json(route, showcase)
    if (path.endsWith('/rpc/admin_set_homepage_showcase')) {
      const body = request.postDataJSON()
      showcaseSaves.push(body)
      if (saveError) return json(route, { code: saveError, message: 'Save failed' }, 409)
      showcase = { ...showcase, selectedStoreIds: body.selected_store_ids }
      return json(route, showcase)
    }
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
    showcaseSaves,
    failSave: (code: string) => { saveError = code },
    failLoad: (fail: boolean) => { loadError = fail },
    setCatalog: (next: typeof stores) => { catalog = next },
  }
}

const names = (page: Page) => page.locator('.admin-directory__identity strong')

test('admin selects homepage shops, sees unavailable reasons, and persists the choice', async ({ page }) => {
  const backend = await installBackend(page)
  await page.goto('/admin/kaubamaja?view=homepage')
  const first = page.getByRole('checkbox', { name: stores[0].store_name })
  const second = page.getByRole('checkbox', { name: stores[1].store_name })
  const third = page.getByRole('checkbox', { name: stores[2].store_name })
  await expect(first).toBeChecked()
  await expect(second).toBeChecked()
  await expect(third).not.toBeChecked()
  await expect(page.getByText('Pood on avaldamata — eelvaates ei näidata.')).toBeVisible()
  await expect(page.getByText('Puudub avalik laos olev toode, millel on pilt ja hind.')).toBeVisible()
  await second.uncheck()
  await page.getByRole('button', { name: 'Salvesta valik' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Valik on salvestatud' })).toBeVisible()
  expect(backend.showcaseSaves).toEqual([{ selected_store_ids: [stores[0].store_id], expected_store_ids: [stores[0].store_id, stores[1].store_id] }])
  await page.reload()
  await expect(first).toBeChecked()
  await expect(second).not.toBeChecked()
  await page.screenshot({ path: 'output/admin-homepage-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'output/admin-homepage-mobile.png', fullPage: true })
  await first.uncheck()
  await expect(page.getByRole('button', { name: 'Salvesta valik' })).toBeDisabled()
  await expect(page.getByText('Vali vähemalt üks pood.')).toBeVisible()
})

test('homepage selection survives failed saves and supports tab keyboard navigation', async ({ page }) => {
  const backend = await installBackend(page)
  await page.goto('/admin/kaubamaja?view=order')
  await page.getByRole('tab', { name: 'Poodide järjekord' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Avalehe eelvaade' })).toBeFocused()
  await expect(page).toHaveURL(/view=homepage/)
  await page.getByRole('checkbox', { name: stores[1].store_name }).uncheck()
  backend.failSave('40001')
  await page.getByRole('button', { name: 'Salvesta valik' }).click()
  await expect(page.getByRole('alert')).toContainText('Valik on vahepeal muutunud')
  await expect(page.getByRole('checkbox', { name: stores[1].store_name })).not.toBeChecked()
  await page.getByRole('button', { name: 'Laadi salvestatud valik' }).click()
  await expect(page.getByRole('checkbox', { name: stores[1].store_name })).toBeChecked()
})

test('admin drags and saves the order, which survives reload and reaches the public directory', async ({ page }) => {
  const backend = await installBackend(page)
  await page.goto('/admin/kaubamaja?view=order')
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
  await page.goto('/admin/kaubamaja?view=order')
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
  await page.goto('/admin/kaubamaja?view=order')
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
  await page.goto('/admin/kaubamaja?view=order')
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
  await page.goto('/admin/kaubamaja?view=order')
  await expect(page.getByText('Sellel kontol puudub administraatori ligipääs.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Salvesta järjekord' })).toHaveCount(0)
})


test('admin sees temporary email flags, inactive review and signup volume without losing registrations', async ({ page }) => {
  await installBackend(page)
  const users = [
    { user_id: 'temp', email: 'trial@minitts.net', email_is_disposable: true, email_confirmed: true, email_review_required: true },
    { user_id: 'pending', email: 'pending@tozya.com', email_is_disposable: true, email_confirmed: false, email_review_required: false },
    { user_id: 'regular', email: 'merchant@example.com', email_is_disposable: false, email_confirmed: true, email_review_required: false },
  ].map((row) => ({ ...row, user_created_at: '2026-09-29T09:00:00Z', product_count: 0, order_count: 0,
    gross_sales: 0, open_support_count: 0, stripe_account_requirement_issues: [], last_activity_at: null }))
  await page.route('**/rpc/admin_dashboard_users', (route) => jsonReply(route, users))
  await page.route('**/rpc/admin_signup_alerts', (route) => jsonReply(route, [{ requests: 5 }]))
  await page.goto('/admin/users')
  await expect(page.locator('.admin-user-row')).toHaveCount(3)
  await expect(page.locator('.admin-email-flag').filter({ hasText: 'Ajutine e-post' })).toHaveCount(2)
  await expect(page.getByText('Tavapärasest rohkem registreerumiskatseid')).toBeVisible()
  await page.getByRole('button', { name: 'Ajutine e-post', exact: true }).click()
  await expect(page.locator('.admin-user-row')).toHaveCount(2)
  await page.getByRole('button', { name: 'E-posti ülevaatus', exact: true }).click()
  await expect(page.locator('.admin-user-row')).toHaveCount(1)
  await expect(page.locator('.admin-user-row')).toContainText('trial@minitts.net')
  await page.getByRole('button', { name: 'Kõik', exact: true }).click()
  await expect(page.locator('.admin-user-row')).toHaveCount(3)
  await page.screenshot({ path: 'output/account-email-admin.png', fullPage: true })
})

const jsonReply = (route: Route, value: unknown) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(value) })

test('payment review shows refund recovery separately and requires evidence for entrepreneur approval', async ({ page }) => {
  await installBackend(page)
  const actions: Record<string, unknown>[] = []
  const reviews = {
    orders: [{ id: 'order-test', order_number: 'PR-TEST', store_name: 'Ateljee', stripe_mode: 'test', stripe_payment_intent_id: 'pi_test', stripe_payment_issue: 'funds_required', payment_status: 'refunded', last_error: 'FUNDS_REQUIRED:reversal: Raha puudub.' }],
    sellers: [{ id: 'store-test', name: 'Ateljee', seller_name: 'Liisa Tamm', stripe_account_id: 'acct_test', stripe_account_mode: 'test', bank: { id: 'ba_test', last4: '1234', bank_name: 'LHV' }, verified_at: null }],
  }
  await page.route('**/__e2e_supabase/rest/v1/rpc/admin_payment_reviews', route => route.fulfill({ json: reviews, headers: { 'Access-Control-Allow-Origin': '*' } }))
  await page.route('**/__e2e_supabase/functions/v1/payment-review', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    actions.push(route.request().postDataJSON())
    return route.fulfill({ json: { ok: true }, headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  await page.goto('/admin/payments')
  await expect(page.getByRole('heading', { name: 'Maksete kontroll', exact: true })).toBeVisible()
  await expect(page.getByText('Ostja makse on juba tagastatud;', { exact: false })).toBeVisible()
  const approve = page.getByRole('button', { name: 'Täielik IBAN, aktiivne ettevõtluskonto ja omanik kontrollitud — kinnita' })
  await expect(approve).toBeDisabled()
  await page.getByLabel('Kontrolli tõend ja kuupäev').fill('MTA kontroll 30.09.2026 ja privaatse tõendi viide 123')
  await approve.click()
  await expect.poll(() => actions.length).toBe(1)
  expect(actions[0]).toMatchObject({ action: 'approve-seller', storeId: 'store-test', bankId: 'ba_test' })
  await page.getByRole('button', { name: 'Saldo kontrollitud — proovi tagastust uuesti' }).click()
  await expect(page.getByRole('status')).toContainText('Tagastus lisati uuesti tööjärjekorda')
  expect(actions[1]).toEqual({ action: 'retry-refund', orderId: 'order-test' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'output/payment-reviews-mobile.png', fullPage: true })
})
