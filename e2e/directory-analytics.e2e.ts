import { expect, test, type Page, type Route } from '@playwright/test'
import type { DirectoryEvent } from '../supabase/functions/_shared/directory-analytics'
import type { DirectoryReport } from '../src/lib/directoryAnalyticsAdmin'

test.use({ baseURL: 'http://poeruum.localhost:4174' })
const storeId = '10000000-0000-4000-8000-000000000001'
const catalog = [{ store_id: storeId, store_name: 'Keraamika Stuudio', store_slug: 'keraamika-stuudio', products: [
  { id: 'blue-vase', name: 'Sinine vaas', slug: 'sinine-vaas', price: 25, image_url: '/images/poeruumi-kaubamaja-hero.webp', search_visible: true },
] }, ...Array.from({ length: 5 }, (_, index) => ({ store_id: `10000000-0000-4000-8000-00000000000${index + 2}`, store_name: `Pood ${index + 2}`, store_slug: `pood-${index + 2}`, products: [] }))]
const metrics = { visits: 120, impressions: 80, store_clicks: 16, product_clicks: 12, outbound_visits: 20, searches: 30, empty_searches: 5, average_position: 2.4, ctr: 20 }
function report(days = 30, id: string | null = null): DirectoryReport {
  return {
    range_days: days, from_date: '2026-09-01', to_date: '2026-09-30', previous_from_date: '2026-08-02', previous_to_date: '2026-08-31',
    tracking_started_at: '2026-01-01T00:00:00Z', comparison_available: true,
    store: id ? { id, name: 'Keraamika Stuudio' } : null, current: metrics, previous: { ...metrics, visits: 60, store_clicks: 8 },
    daily: Array.from({ length: days }, (_, index) => ({ date: new Date(Date.UTC(2026, 8, index + 1)).toISOString().slice(0, 10), visits: index + 1, impressions: index, store_clicks: index % 5, product_clicks: index % 3 })),
    sources: [{ label: 'google.com', visits: 80 }, { label: 'Otse / teadmata', visits: 40 }], devices: [{ label: 'mobile', visits: 90 }, { label: 'desktop', visits: 30 }],
    stores: catalog.map((store, index) => ({ id: store.store_id, name: store.store_name, slug: store.store_slug, is_published: true, position: index + 1, current: index === 0 ? metrics : { ...metrics, impressions: 0, store_clicks: 0, product_clicks: 0, ctr: null }, previous: metrics })),
    products: id ? [{ id: 'blue-vase', name: 'Sinine vaas', clicks: 12, previous_clicks: 6 }] : [],
    placements: id ? [{ placement: 'directory', impressions: 80, clicks: 16, average_position: 2.4 }] : [],
  }
}

async function backend(page: Page, admin = true) {
  const events: DirectoryEvent[] = []
  const requests: { requested_days: number; requested_store_id: string | null }[] = []
  let fail = false
  let empty = false
  let failures = 0
  const user = { id: storeId, email: 'admin@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { role: 'admin' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', app_metadata: user.app_metadata, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'test-signature'].join('.')
  const session = { access_token: token, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  if (admin) await page.addInitScript((value) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(value)), session)
  const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value), headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
  await page.route('**/__e2e_supabase/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } })
    if (path.endsWith('/auth/v1/user')) return json(route, user)
    if (path.endsWith('/auth/v1/token')) return json(route, session)
    if (path.endsWith('/rpc/storefront_seo_catalog')) return json(route, catalog)
    if (path.endsWith('/rpc/admin_directory_analytics')) {
      const body = route.request().postDataJSON()
      requests.push(body)
      if (fail) return json(route, { message: 'Unavailable' }, 500)
      const result = report(body.requested_days, body.requested_store_id)
      if (empty) { result.current = { ...metrics, visits: 0 }; result.comparison_available = false }
      return json(route, result)
    }
    if (path.endsWith('/functions/v1/directory-analytics')) {
      const payload = JSON.parse(route.request().postData()!)
      events.push(...payload.events)
      if (failures > 0) { failures--; return json(route, { error: 'Temporary' }, 503) }
      return json(route, { accepted: true }, 202)
    }
    if (path.endsWith('/platform_settings')) return json(route, null)
    return json(route, [])
  })
  return { events, requests, fail: (value: boolean) => { fail = value }, empty: () => { empty = true }, retry: () => { failures = 1 } }
}

test('admin sees overall and store metrics, switches periods, and keeps an unsaved ordering draft', async ({ page }) => {
  const api = await backend(page)
  await page.goto('/admin/kaubamaja')
  await expect(page.getByRole('heading', { name: 'Kaubamaja statistika', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Poodide võrdlus' })).toBeVisible()
  await expect(page.getByText('+100% eelmise perioodiga').first()).toBeVisible()
  await page.getByRole('button', { name: '7 päeva', exact: true }).click()
  await expect.poll(() => api.requests.at(-1)?.requested_days).toBe(7)
  await page.getByRole('button', { name: 'Keraamika Stuudio' }).click()
  await expect(page.getByRole('heading', { name: 'Keraamika Stuudio', exact: true })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Sinine vaas' })).toBeVisible()
  expect(api.requests.at(-1)).toEqual({ requested_days: 7, requested_store_id: storeId })
  await page.getByRole('button', { name: 'Kõik poed' }).click()
  await expect(page.getByRole('heading', { name: 'Poodide võrdlus' })).toBeVisible()
  await page.getByRole('tab', { name: 'Poodide järjekord' }).click()
  await page.getByRole('button', { name: 'Liiguta Pood 2 üles' }).click()
  await page.getByRole('tab', { name: 'Statistika', exact: true }).click()
  await expect(page.getByRole('button', { name: '7 päeva', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: 'output/directory-statistics-desktop.png', fullPage: true })
  await page.getByRole('tab', { name: 'Poodide järjekord' }).click()
  await expect(page.locator('.admin-directory__identity strong').first()).toHaveText('Pood 2')
  await expect(page.getByRole('button', { name: 'Salvesta järjekord' })).toBeEnabled()
})

test('mobile statistics handles errors and missing history without page overflow', async ({ page }) => {
  const api = await backend(page)
  api.fail(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin/kaubamaja')
  await expect(page.getByRole('alert')).toContainText('ei õnnestunud laadida')
  api.fail(false); api.empty()
  await page.getByRole('button', { name: 'Proovi uuesti' }).click()
  await expect(page.getByText('Valitud perioodil pole veel külastusi registreeritud.')).toBeVisible()
  await expect(page.getByText('Varasemate külastuste ajalugu puudub.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '90 päeva', exact: true }).click()
  await expect.poll(() => api.requests.at(-1)?.requested_days).toBe(90)
  await expect(page.getByRole('heading', { name: 'Poodide võrdlus' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'output/directory-statistics-mobile.png', fullPage: true })
})

test('public directory measures visible cards, retries idempotently, and keeps search text out of events', async ({ page }) => {
  const api = await backend(page, false)
  api.retry()
  await page.goto('http://kaubamaja.poeruum.localhost:4174/')
  await expect.poll(() => api.events.filter((event) => event.event_name === 'page_view').length).toBe(2)
  expect(api.events[0].id).toBe(api.events[1].id)
  expect(api.events.filter((event) => event.event_name === 'store_impression')).toHaveLength(0)
  const highlight = page.getByRole('region', { name: 'Leide Eesti poodidest' }).getByRole('link')
  await highlight.dispatchEvent('auxclick', { button: 1 })
  await expect.poll(() => api.events.find((event) => event.event_name === 'product_click' && event.placement === 'directory')).toMatchObject({
    store_id: storeId, product_id: 'blue-vase', position: 1,
  })
  const first = page.locator('.store-directory__card').first()
  await first.scrollIntoViewIfNeeded()
  await expect.poll(() => api.events.filter((event) => event.event_name === 'store_impression').length).toBeGreaterThan(0)
  const impressions = api.events.filter((event) => event.event_name === 'store_impression')
  expect(impressions.some((event) => event.store_id === catalog[5].store_id)).toBe(false)
  expect(impressions.find((event) => event.store_id === storeId)?.position).toBe(1)
  await first.getByRole('link').dispatchEvent('auxclick', { button: 1 })
  await expect.poll(() => api.events.some((event) => event.event_name === 'store_click' && event.store_id === storeId)).toBe(true)
  const input = page.getByRole('searchbox')
  await input.fill('private@example.invalid')
  await expect.poll(() => api.events.some((event) => event.event_name === 'search' && event.result_count === 0)).toBe(true)
  expect(JSON.stringify(api.events)).not.toContain('private@example.invalid')
  await input.fill('vaas')
  await expect(page.locator('.store-directory__product')).toHaveCount(1)
  await page.locator('.store-directory__product a').dispatchEvent('auxclick', { button: 1 })
  await expect.poll(() => api.events.some((event) => event.event_name === 'product_click' && event.product_id === 'blue-vase' && event.placement === 'search')).toBe(true)
  await page.reload()
  await expect(page.locator('.store-directory__product')).toHaveCount(1)
  await input.fill('')
  const example = page.getByRole('link', { name: /loo oma pood Poeruumis/ }).first()
  await example.scrollIntoViewIfNeeded()
  await example.dispatchEvent('auxclick', { button: 1 })
  // A new search event is a flush barrier; reloading starts a new in-memory visit.
  const searches = api.events.filter((event) => event.event_name === 'search').length
  await input.fill('nowhere')
  await expect.poll(() => api.events.filter((event) => event.event_name === 'search').length).toBeGreaterThan(searches)
  expect(api.events.filter((event) => event.event_name === 'page_view')).toHaveLength(3)
  expect(api.events.filter((event) => event.store_id).every((event) => catalog.some((store) => store.store_id === event.store_id))).toBe(true)
})

test('administrator browsing the public directory is excluded from collection', async ({ page }) => {
  const api = await backend(page)
  await page.goto('http://kaubamaja.poeruum.localhost:4174/')
  await page.locator('.store-directory__card').first().scrollIntoViewIfNeeded()
  await page.locator('.store-directory__card a').first().dispatchEvent('auxclick', { button: 1 })
  await page.getByRole('searchbox').fill('vaas')
  await expect(page.locator('.store-directory__product')).toHaveCount(1)
  await page.waitForTimeout(2000)
  expect(api.events).toEqual([])
})
