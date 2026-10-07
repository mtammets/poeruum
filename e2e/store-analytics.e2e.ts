import { expect, test, type Page, type Route } from '@playwright/test'
import type { StoreAnalyticsReport } from '../src/lib/storeAnalytics'

const storeId = '10000000-0000-4000-8000-000000000071'
const image = '/images/kaubamaja-example-ceramics.webp'
function report(days: 7 | 30): StoreAnalyticsReport {
  const daily = Array.from({ length: days }, (_, index) => ({
    date: new Date(Date.UTC(2026, 9, 8 - days + index)).toISOString().slice(0, 10),
    visits: [15, 32, 28, 49, 21, 41, 62][index % 7], orders: index % 3, sales: index % 3 * 25,
  }))
  return { store_id: storeId, range_days: days, from_date: daily[0].date, to_date: '2026-10-07', updated_at: '2026-10-07T10:42:00Z',
    tracking_started_at: '2026-01-01T00:00:00Z', comparison_available: true,
    current: { visits: 248, orders: 6, sales: 150 }, previous: { visits: 210, orders: 4, sales: 100 }, daily,
    products: [{ id: 'analytics-cup', name: 'Käsitöökruus', image, views: 186, daily: daily.map((point) => ({ date: point.date, views: point.visits - 4 })) },
      { id: 'analytics-plate', name: 'Väike taldrik', image, views: 62, daily: daily.map((point) => ({ date: point.date, views: 2 })) }],
    sources: [{ label: 'Kaubamaja', visits: 134 }, { label: 'Google', visits: 77 }, { label: 'Otse / teadmata', visits: 37 }],
  }
}

async function setup(page: Page, merchant = true) {
  const calls: { requested_days: 7 | 30; target_store_id: string }[] = []
  const events: { id: string; event_name: string; source: string; product_id: string }[] = []
  let fail = false
  let empty = false
  let retryCollection = false
  await page.route('**/storage/v1/object/public/product-images/**', (route) => route.fulfill({ path: 'public/images/kaubamaja-example-ceramics.webp', contentType: 'image/webp' }))
  const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value), headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
  await page.route('**/__e2e_supabase/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, PATCH, OPTIONS' } })
    if (path.endsWith('/rpc/merchant_store_analytics')) {
      const body = route.request().postDataJSON()
      calls.push(body)
      if (fail) return json(route, { message: 'Unavailable' }, 500)
      const data = report(body.requested_days)
      if (empty) {
        data.current = { visits: 0, orders: 0, sales: 0 }; data.products = []; data.sources = []
        data.comparison_available = false; data.tracking_started_at = '2026-10-07T00:00:00Z'
        data.daily = data.daily.map((day, index) => ({ ...day, visits: index === data.daily.length - 1 ? 0 : null, orders: 0, sales: 0 }))
      }
      return json(route, data)
    }
    if (path.endsWith('/functions/v1/store-analytics')) {
      events.push(...JSON.parse(route.request().postData()!).events)
      if (retryCollection) { retryCollection = false; return json(route, {}, 503) }
      return json(route, { accepted: true }, 202)
    }
    if (path.endsWith('/products')) return json(route, [{ id: 'analytics-cup', store_id: storeId, name: 'Käsitöökruus', image_url: `http://localhost:4174/storage/v1/object/public/product-images/${storeId}/cup.webp`, description: 'Käsitsi valmistatud kruus.', price: 25, stock: 20, gallery: [], options: [] }])
    if (path.endsWith('/stores')) return json(route, { id: storeId, settings: { editableStoreName: 'Mavi Stuudio', businessName: 'Mavi OÜ', registryCode: '12345678', businessAddress: 'Tallinn', contactEmail: 'mavi@example.invalid' } })
    if (path.endsWith('/platform_settings')) return json(route, null)
    return json(route, [])
  })
  await page.goto(`http://poeruum.localhost:4174/e2e/store-analytics.html?merchant=${merchant}`)
  await page.getByRole('heading', { name: 'Käsitöökruus' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  return { calls, events, fail: (value: boolean) => { fail = value }, empty: () => { empty = true }, retry: () => { retryCollection = true } }
}

test('merchant opens, explores and refreshes statistics without polling', async ({ page }) => {
  const api = await setup(page)
  const trigger = page.getByRole('button', { name: 'Poe statistika', exact: true })
  await expect(trigger).toBeVisible()
  expect(api.calls).toHaveLength(0)
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Statistika' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('248', { exact: true })).toBeVisible()
  expect(api.calls).toEqual([{ requested_days: 7, target_store_id: storeId }])
  await page.getByRole('button', { name: /^Müük: / }).click()
  await expect(page.getByRole('slider', { name: 'Müük päevade kaupa' })).toBeVisible()
  await page.getByRole('slider').focus()
  await page.keyboard.press('Home')
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '1')
  await page.getByRole('button', { name: /Käsitöökruus 186/ }).click()
  await expect(page.getByRole('slider', { name: 'Toote vaatamised päevade kaupa' })).toBeVisible()
  expect(api.calls).toHaveLength(1)
  await page.clock.install()
  await page.clock.fastForward(120_000)
  expect(api.calls).toHaveLength(1)
  expect(api.events).toHaveLength(0)
  await page.getByRole('button', { name: '30 päeva', exact: true }).click()
  await expect.poll(() => api.calls.at(-1)?.requested_days).toBe(30)
  await expect(page.getByRole('button', { name: 'Värskenda statistikat' })).toBeEnabled()
  await page.getByRole('button', { name: 'Värskenda statistikat' }).click()
  await expect.poll(() => api.calls.length).toBe(3)
  await page.getByRole('button', { name: 'Sulge statistika' }).click()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect.poll(() => api.calls.length).toBe(4)
  await page.getByRole('slider').focus()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 700 }, { width: 360, height: 540 }, { width: 844, height: 390 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 1440, height: 1000 }]) {
  test(`statistics fits ${viewport.width}×${viewport.height} and keeps close accessible`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await setup(page)
    await page.getByRole('button', { name: 'Poe statistika', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('248', { exact: true })).toBeVisible()
    await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    const dimensions = await dialog.boundingBox()
    expect(dimensions!.x).toBeGreaterThanOrEqual(0)
    expect(dimensions!.height).toBeLessThanOrEqual(viewport.height)
    if (viewport.width < 600) expect(dimensions!.width).toBeCloseTo(viewport.width, 1)
    await page.screenshot({ path: `output/store-statistics-${viewport.width}.png`, animations: 'disabled' })
    await page.getByText('Kust tullakse', { exact: true }).scrollIntoViewIfNeeded()
    const close = page.getByRole('button', { name: 'Sulge statistika' })
    await expect(close).toBeInViewport()
    const controls = await close.boundingBox()
    expect(controls!.width).toBeGreaterThanOrEqual(44)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await dialog.evaluate((element) => getComputedStyle(element).animationName)).toBe('none')
    await close.click()
    await expect(page.getByRole('button', { name: 'Poe statistika', exact: true })).toBeFocused()
  })
}

test('errors retain the previous snapshot and new stores show missing history honestly', async ({ page }) => {
  const api = await setup(page)
  await page.getByRole('button', { name: 'Poe statistika', exact: true }).click()
  await expect(page.getByText('248', { exact: true })).toBeVisible()
  api.fail(true)
  await page.getByRole('button', { name: 'Värskenda statistikat' }).click()
  await expect(page.getByRole('alert')).toContainText('Kuvan viimati laaditud andmeid')
  await expect(page.getByText('248', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '30 päeva', exact: true }).click()
  await expect(page.getByText('248', { exact: true })).not.toBeVisible()
  await expect(page.getByText('Graafik pole saadaval')).toBeVisible()
  api.fail(false); api.empty()
  await page.getByRole('button', { name: 'Proovi uuesti' }).click()
  await expect(page.getByText('Ootame esimesi külastusi')).toBeVisible()
  await expect(page.getByText('Külastuste ajalugu alates', { exact: false })).toBeVisible()
  await expect(page.locator('.store-stats__trend')).toHaveCount(0)
  await page.getByRole('slider').focus()
  await page.keyboard.press('Home')
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuetext', /andmed puuduvad/)
})

test('public store collects visits and product views with idempotent retry', async ({ page }) => {
  const api = await setup(page, false)
  api.retry()
  await expect(page.getByRole('button', { name: 'Poe statistika', exact: true })).toHaveCount(0)
  await expect.poll(() => api.events.filter((event) => event.event_name === 'visit').length).toBe(2)
  const visits = api.events.filter((event) => event.event_name === 'visit')
  expect(visits[0].id).toBe(visits[1].id)
  expect(visits[0].source).toBe('Kaubamaja')
  expect(api.events.some((event) => event.event_name === 'product_view' && event.product_id === 'analytics-cup')).toBe(true)
  expect(api.calls).toHaveLength(0)
})

test('merchant customer preview does not collect visits', async ({ page }) => {
  const api = await setup(page)
  await page.getByRole('button', { name: 'Vaata poodi kliendina' }).click()
  await expect(page.getByRole('button', { name: 'Poe statistika', exact: true })).toHaveCount(0)
  await page.waitForTimeout(1800)
  expect(api.events).toHaveLength(0)
})

test.describe('touch statistics', () => {
  test.use({ hasTouch: true })
  test('chart readouts, periods and product details work with taps', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const api = await setup(page)
    await page.getByRole('button', { name: 'Poe statistika', exact: true }).tap()
    const chart = page.getByRole('slider', { name: 'Külastused päevade kaupa' })
    await chart.tap({ position: { x: 25, y: 80 } })
    await expect(chart).toHaveAttribute('aria-valuenow', '1')
    await page.getByRole('button', { name: '30 päeva', exact: true }).tap()
    await expect.poll(() => api.calls.at(-1)?.requested_days).toBe(30)
    await page.getByRole('button', { name: /Käsitöökruus 186/ }).tap()
    await expect(page.getByRole('slider', { name: 'Toote vaatamised päevade kaupa' })).toBeVisible()
    await page.getByRole('button', { name: 'Sulge statistika' }).tap()
    await expect(page.getByRole('button', { name: 'Poe statistika', exact: true })).toBeFocused()
  })
})
