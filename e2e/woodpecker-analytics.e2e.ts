import { expect, test, type Page } from '@playwright/test'
import type { WoodpeckerReport } from '../src/lib/woodpeckerAnalytics'

test.use({ baseURL: 'http://poeruum.localhost:4174' })
const report: WoodpeckerReport = {
  starts_at: '2026-11-04T04:00:00Z', ends_at: '2026-11-30T22:00:00Z', tracking_started_at: '2026-11-04T04:00:00Z',
  from: '2026-11-04T04:00:00Z', to: '2026-11-04T16:00:00Z', updated_at: '2026-11-04T16:00:00Z', bucket: 'hour',
  totals: { visits: 2846, players: 186, games: 312, hats: 1824, best: 43, game_seconds: 142, game_buyers: 12, orders: 38, sales: 1102, attributed_orders: 32, refunds: 29, active: 24 },
  surfaces: [{ surface: 'directory', visits: 1620, visitors: 1306, clicks: 384, product_views: 0, checkouts: 47, full_scrolls: 640, seconds: 96 },
    { surface: 'homepage', visits: 742, visitors: 608, clicks: 218, product_views: 0, checkouts: 0, full_scrolls: 395, seconds: 134 },
    { surface: 'store', visits: 484, visitors: 413, clicks: 0, product_views: 926, checkouts: 38, full_scrolls: 186, seconds: 82 }],
  timeline: [30, 45, 86, 130, 112, 165, 220, 190, 260, 230, 286, 210, 110].map((n, i) => ({ time: `2026-11-04T${String(i + 4).padStart(2, '0')}:00:00Z`, directory: n, homepage: Math.round(n * .45), store: Math.round(n * .27), measured: true })),
  sources: [{ label: 'Facebook', visits: 1210 }, { label: 'Instagram', visits: 782 }, { label: 'Otse / teadmata', visits: 416 }, { label: 'Google', visits: 286 }, { label: 'Krük Krüki koduleht', visits: 152 }],
  devices: [{ label: 'mobile', visits: 2182 }, { label: 'desktop', visits: 572 }, { label: 'tablet', visits: 92 }],
  actions: [{ label: 'product_interest', events: 1320, sessions: 604 }, { label: 'add_to_cart', events: 126, sessions: 112 }, { label: 'checkout_start', events: 92, sessions: 85 }, { label: 'checkout_redirect', events: 45, sessions: 41 }, { label: 'checkout_error', events: 3, sessions: 2 }, { label: 'game_view', events: 428, sessions: 310 }, { label: 'bird_call', events: 296, sessions: 215 }],
  products: [{ product_id: 'cap', name: '2rähni nokkmüts', image: '/images/campaigns/kruk-cap-cutout-v1.webp', views: 926, carts: 112, clicks: 384 }],
  utms: [{ source: 'Facebook', campaign: 'musta-rahni', visits: 920 }, { source: 'Instagram', campaign: 'musta-rahni-story', visits: 612 }],
  players: [
    { visitor_id: '10000000-0000-4000-8000-000000000001', customer_name: 'Mari Maasikas', games: 4, hats: 87, best: 32, seconds: 648, last_seen: '2026-11-04T15:52:00Z', device: 'desktop', source: 'Facebook', orders: 1, sales: 29 },
    { visitor_id: '20000000-0000-4000-8000-000000000002', customer_name: null, games: 2, hats: 61, best: 43, seconds: 312, last_seen: '2026-11-04T15:47:00Z', device: 'desktop', source: 'Google', orders: 0, sales: 0 },
    { visitor_id: '30000000-0000-4000-8000-000000000003', customer_name: 'Jaan Tamm', games: 1, hats: 12, best: 12, seconds: 124, last_seen: '2026-11-04T15:40:00Z', device: 'mobile', source: 'Instagram', orders: 2, sales: 58 },
  ], player_count: 3, player_page: 0,
}
async function backend(page: Page, admin = true) {
  let failed = false
  const requests: Record<string, unknown>[] = []
  const user = { id: '20000000-0000-4000-8000-000000000001', email: 'admin@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: admin ? { role: 'admin' } : {}, user_metadata: {}, created_at: '2026-09-01T00:00:00Z' }
  const accessToken = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', app_metadata: user.app_metadata, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'playwright-signature'].join('.')
  const session = { access_token: accessToken, refresh_token: 'playwright-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  await page.addInitScript(s => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(s)), session)
  await page.route('**/__e2e_supabase/**', async route => {
    const path = new URL(route.request().url()).pathname
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value), headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    if (path.endsWith('/auth/v1/token')) return json(session)
    if (path.endsWith('/auth/v1/user')) return json(user)
    if (path.endsWith('/rpc/admin_woodpecker_analytics')) {
      const input = route.request().postDataJSON(); requests.push(input)
      if (failed) return json({ message: 'Unavailable' }, 500)
      const players = report.players.filter(p => !input.player_search || p.customer_name?.includes(input.player_search) || p.visitor_id.includes(input.player_search))
      return json({ ...report, players, player_count: players.length, player_page: input.player_page })
    }
    if (path.endsWith('/platform_settings')) return json(null)
    return json([])
  })
  return { requests, fail: (value: boolean) => { failed = value } }
}

test('campaign dashboard displays real report fields, filters, CSV and responsive layout', async ({ page }) => {
  const api = await backend(page)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.setViewportSize({ width: 1512, height: 1100 })
  await page.goto('/admin/musta-rahni')
  await expect(page.getByRole('heading', { name: 'Musta rähni päevad.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Musta rähni päevad' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('cell', { name: 'Mari Maasikas' })).toBeVisible()
  await expect(page.getByText('Anonüümne lehesessioon')).toBeVisible()
  await expect(page.locator('.woodpecker-kpi').first()).toContainText(/2\s*846/)
  await page.screenshot({ path: 'output/woodpecker-desktop.png', fullPage: true })
  await page.getByRole('button', { name: '24 tundi', exact: true }).click()
  await expect.poll(() => api.requests.at(-1)?.requested_range).toBe('24h')
  await page.getByRole('searchbox', { name: 'Otsi mängijat' }).fill('Mari')
  await expect(page.locator('.woodpecker-players tbody tr')).toHaveCount(1)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Mängijate CSV' }).click()
  expect((await download).suggestedFilename()).toBe('musta-rahni-mangijad.csv')
  await page.getByRole('searchbox', { name: 'Otsi mängijat' }).fill('')
  await expect(page.locator('.woodpecker-players tbody tr')).toHaveCount(3)
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: `output/woodpecker-${width}.png`, fullPage: true })
  }
  expect(errors).toEqual([])
})

test('failed campaign request is recoverable and never presented as zero sales', async ({ page }) => {
  const api = await backend(page); api.fail(true)
  await page.goto('/admin/musta-rahni')
  await expect(page.getByRole('alert').filter({ hasText: 'Kampaania statistikat' })).toBeVisible()
  await expect(page.locator('.woodpecker-kpi')).toHaveCount(0)
  api.fail(false)
  await page.getByRole('button', { name: 'Proovi uuesti' }).click()
  await expect(page.locator('.woodpecker-kpi')).toHaveCount(4)
})

test('merchant cannot see campaign statistics or trigger its report RPC', async ({ page }) => {
  const api = await backend(page, false)
  await page.goto('/admin/musta-rahni')
  await expect(page.locator('.woodpecker')).toHaveCount(0)
  await expect(page.getByText('Administraator', { exact: true })).not.toBeVisible()
  expect(api.requests).toHaveLength(0)
})

test('an automatic flight is not a player; real controls send one game and a final score', async ({ page }) => {
  const events: Record<string, unknown>[] = []
  const storeId = '10000000-0000-4000-8000-000000000001'
  const product = { id: 'cap', name: 'Nokkmüts', slug: 'nokkmuts', price: 29, image_url: '/images/campaigns/kruk-cap-cutout-v1.webp', stock: 5, search_visible: true }
  await page.clock.install({ time: new Date('2026-11-04T06:00:00Z') })
  await page.route('**/__e2e_supabase/**', async route => {
    const path = new URL(route.request().url()).pathname
    let json: unknown = []
    if (path.endsWith('/functions/v1/woodpecker-analytics')) {
      events.push(...route.request().postDataJSON().events)
      return route.fulfill({ json: { accepted: true }, status: 202 })
    }
    if (path.endsWith('/rpc/get_directory_campaign')) json = { mode: 'on', revision: 1, startsAt: '2026-11-04T04:00:00Z', endsAt: null, serverNow: '2026-11-04T06:00:00Z' }
    if (path.endsWith('/rpc/storefront_seo_catalog')) json = [{ store_id: storeId, store_name: 'Krük-Krük', store_slug: 'kruk-kruk', products: [product] }]
    return route.fulfill({ json })
  })
  await page.goto('http://kaubamaja.poeruum.localhost:4174/')
  const bird = page.getByRole('button', { name: 'Alusta rähnimängu', exact: true })
  await expect(bird).toBeVisible()
  await page.clock.runFor(1000)
  await expect.poll(() => events.some(e => e.event_name === 'visit')).toBe(true)
  await bird.press('Enter')
  const flight = page.getByRole('dialog', { name: 'Rähni lennuvaade' })
  await expect(flight).toBeVisible()
  await page.clock.runFor(1000)
  await expect.poll(() => events.some(e => e.event_name === 'game_view')).toBe(true)
  expect(events.some(e => e.event_name === 'game_start')).toBe(false)
  await page.keyboard.down('ArrowLeft')
  await page.clock.runFor(1800)
  await page.keyboard.up('ArrowLeft')
  await page.keyboard.press('Escape')
  await expect(flight).toHaveCount(0)
  await expect.poll(() => events.filter(e => e.event_name === 'game_end').length).toBeGreaterThan(0)
  const started = events.filter(e => e.event_name === 'game_start')
  expect(started).toHaveLength(1)
  expect(events.filter(e => e.event_name === 'game_end').every(e => e.game_id === started[0].game_id)).toBe(true)
  expect(await page.evaluate(() => document.cookie.includes('poeruum_musta_rahni'))).toBe(false)
})
