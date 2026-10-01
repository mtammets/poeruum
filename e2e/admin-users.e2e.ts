import { expect, test, type Page, type Route, type WebSocketRoute } from '@playwright/test'

test.use({ baseURL: 'http://poeruum.localhost:4174' })

const now = Date.parse('2026-10-01T11:00:00Z')
const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString()
const steps = ['has_store_details', 'has_payments', 'has_delivery', 'has_product', 'has_business_details', 'has_published'] as const
const users = [
  ['Angel Airshe', 'artist@example.invalid', 4],
  ['testit', 'test@example.invalid', 3],
  [null, 'new@example.invalid', 0],
  ['Moreamoreceramics', 'ceramics@example.invalid', 6],
  ['VeidradAsjad', 'things@example.invalid', 4],
  ['Krük-Krük', 'kruk@example.invalid', 6],
  ['Argentum Estonicum', 'silver@example.invalid', 6],
  ['tootmine', 'info@example.invalid', 3],
  ['URGITS', 'urgits@example.invalid', 6],
].map(([name, email, count], index) => ({
  user_id: `20000000-0000-4000-8000-00000000000${index}`,
  email: String(email), user_created_at: ago((index + 1) * 24), last_sign_in_at: ago(17),
  store_id: name ? `store-${index}` : null, store_name: name, store_slug: `shop-${index}`,
  custom_hostname: null, store_created_at: ago((index + 1) * 24),
  is_published: count === 6, payment_status: count === 6 ? 'connected' : 'pending',
  stripe_account_requirement_issues: [1, 4, 7].includes(index) ? [{ code: 'verification_missing_directors', requirement: 'company.directors_provided' }] : [],
  pricing_plan: 'flexible', product_count: count === 6 ? 16 : 0, order_count: index > 4 && count === 6 ? 3 : 0, gross_sales: 0,
  last_activity_at: index === 2 ? null : ago(index === 0 ? 8 : 17),
  ...Object.fromEntries(steps.map((step, stepIndex) => [step, stepIndex < Number(count)])),
  // A later step can be complete while payments still require setup.
  has_payments: count === 6 || index === 0, has_business_details: Number(count) >= 3,
  has_product: Number(count) >= 4 && index !== 0, has_delivery: Number(count) >= 3,
  open_support_count: index === 4 ? 1 : 0, last_support_at: ago(22 * 24),
  email_confirmed: index !== 2, email_is_disposable: [1, 2].includes(index), email_review_required: false,
}))

const userMetrics = users.map((row, index) => ({
  user_id: row.user_id, metrics_version: 1, payment_state: [1, 4, 7].includes(index) ? 'restricted' : index === 2 ? 'not_connected' : index === 0 ? 'active' : 'active',
  payment_checked_at: ago(1), paid_orders_30d: index === 3 ? 4 : index === 5 ? 1 : index === 8 ? 8 : 0,
  net_sales_30d_cents: index === 3 ? 48600 : index === 5 ? 9400 : index === 8 ? 268339 : 0,
  paid_orders_total: index === 3 ? 4 : index === 5 ? 1 : index === 8 ? 8 : 0,
  last_paid_order_at: [3, 5, 8].includes(index) ? ago(2) : null,
  awaiting_admin_count: index === 4 ? 1 : 0, waiting_user_count: index === 1 ? 1 : 0,
  awaiting_admin_conversation_id: index === 4 ? 'conversation-test' : null,
}))

function insightFixture(index: number, metrics = userMetrics) {
  const metric = metrics[index]
  const count = metric.paid_orders_30d
  const amounts = Array.from({ length: count }, (_, i) => i === count - 1 ? metric.net_sales_30d_cents - Math.floor(metric.net_sales_30d_cents / count) * (count - 1) : Math.floor(metric.net_sales_30d_cents / count))
  return {
    detail_version: 1, user_id: users[index].user_id, generated_at: ago(0),
    sales_days: Array.from({ length: 31 }, (_, day) => ({
      day: ago((30 - day) * 24).slice(0, 10),
      orders: day % 3 === 0 && day / 3 < count ? 1 : 0,
      net_cents: day % 3 === 0 && day / 3 < count ? amounts[day / 3] : 0,
    })),
    order_states: { paid: count, pending: count ? 2 : 0, failed: count ? 1 : 0, refunded: 0 },
    first_paid_order_at: count ? ago(28 * 24) : null,
    first_product_at: users[index].product_count ? ago(30 * 24) : null,
    last_product_at: users[index].product_count ? ago(4 * 24) : null,
    products_added_30d: users[index].product_count ? 3 : 0, support_resolved: 2,
    payments: { live: true, charges_enabled: metric.payment_state === 'active', payouts_enabled: metric.payment_state === 'active' },
  }
}

async function installBackend(page: Page) {
  let rows = structuredClone(users)
  let metrics = structuredClone(userMetrics)
  let metricsFail = false
  let insightsFail = false
  const insightRequests: string[] = []
  let onlineIds = [users[3].user_id, users[8].user_id]
  let socket: WebSocketRoute | undefined
  const subscriptions = new Map<string, { topic: string; joinRef: string; id: number }>()
  await page.clock.install({ time: now })
  const user = {
    id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.invalid',
    aud: 'authenticated', role: 'authenticated', app_metadata: { role: 'admin' }, user_metadata: {}, created_at: ago(365 * 24),
  }
  const accessToken = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', app_metadata: user.app_metadata, exp: Math.floor(now / 1000) + 3600 })).toString('base64url'),
    'playwright-signature',
  ].join('.')
  const session = { access_token: accessToken, refresh_token: 'playwright-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, user }
  await page.addInitScript((session) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session)), session)
  const json = (route: Route, value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
  await page.route('**/__e2e_supabase/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/v1/token')) return json(route, session)
    if (path.endsWith('/auth/v1/user')) return json(route, user)
    if (path.endsWith('/rpc/admin_user_insights')) {
      const id = route.request().postDataJSON().target_user_id
      insightRequests.push(id)
      return insightsFail ? route.fulfill({ status: 503, json: { message: 'Unavailable' } }) : json(route, insightFixture(users.findIndex((row) => row.user_id === id), metrics))
    }
    if (path.endsWith('/rpc/admin_user_overview')) return metricsFail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Unavailable' }) }) : json(route, metrics)
    if (path.endsWith('/rpc/admin_dashboard_users')) return json(route, rows)
    if (path.endsWith('/rpc/admin_user_presence')) return json(route, onlineIds.map((user_id) => ({ user_id, current_view: user_id === users[0].user_id ? 'payments' : 'storefront', last_seen_at: ago(0) })))
    if (path.endsWith('/rpc/admin_online_users')) return json(route, onlineIds.map((user_id) => ({ user_id })))
    if (path.endsWith('/rpc/admin_latest_email_deliveries')) return json(route, rows.filter((_, i) => i !== 7).map((row, index) => ({
      user_id: row.user_id, resend_email_id: row.user_id, subject: index < 2 ? 'Seadistuse meeldetuletus' : 'Kinnita oma Poeruumi konto',
      email_type: index < 2 ? 'onboarding_reminder' : 'confirmation', status: index === 0 ? 'sent' : 'delivered', sent_at: ago(12), status_updated_at: ago(12),
    })))
    if (path.endsWith('/platform_settings')) return json(route, null)
    return json(route, [])
  })
  await page.routeWebSocket('**/realtime/v1/websocket**', (ws) => {
    socket = ws
    ws.onMessage((message) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message))
      if (event === 'phx_join') {
        const changes = (payload.config?.postgres_changes ?? []).map((change: { table: string }, index: number) => {
          subscriptions.set(change.table, { topic, joinRef, id: index + 1 })
          return { ...change, id: index + 1 }
        })
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: changes } }]))
      } else if (event === 'heartbeat') {
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]))
      }
    })
  })
  return {
    insightRequests,
    failInsights: (fail: boolean) => { insightsFail = fail },
    setRows: (next: typeof users) => { rows = next },
    setMetrics: (next: typeof userMetrics) => { metrics = next },
    failMetrics: (fail: boolean) => { metricsFail = fail },
    setOnline: (next: string[]) => { onlineIds = next },
    subscriptions,
    emit: (table: string) => {
      const channel = subscriptions.get(table)!
      socket!.send(JSON.stringify([channel.joinRef, null, channel.topic, 'postgres_changes', {
        ids: [channel.id], data: { schema: 'public', table, type: 'UPDATE', commit_timestamp: new Date(now).toISOString(), columns: [], record: { id: true }, old_record: {} },
      }]))
    },
  }
}

test('overview separates publication, sales, payments and support, with history in details', async ({ page }) => {
  await installBackend(page)
  await page.setViewportSize({ width: 1680, height: 1100 })
  await page.goto('/admin/users')
  await expect(page.locator('.admin-user-row')).toHaveCount(9)
  await expect(page.getByRole('button', { name: 'Avalikud poed', exact: true })).toContainText('4')
  await expect(page.getByRole('button', { name: 'Müügiga · 30 p', exact: true })).toContainText('3')
  await expect(page.getByRole('button', { name: 'Ootab vastust', exact: true })).toContainText('1')
  await expect(page.locator('.admin-users__online')).toContainText('2 ühendatud')
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.getByText('Seadistuse meeldetuletus', { exact: true })).not.toBeVisible()
  await expect(page.locator('.admin-user-row').nth(1).locator('.admin-user-row__support')).toHaveText('Ootab kasutajat')
  await expect(page.getByRole('link', { name: 'Vasta 1', exact: true })).toHaveAttribute('href', '/admin/support?conversation=conversation-test')
  await page.screenshot({ path: 'output/admin-users-desktop.png', fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Müügiga · 30 p', exact: true }).click()
  await expect(page.locator('.admin-user-row')).toHaveCount(3)
  await page.getByRole('combobox', { name: 'Järjesta kasutajad' }).selectOption('sales')
  await expect(page.locator('.admin-user-row').first()).toContainText('URGITS')
  await page.getByRole('searchbox').fill('ceramics')
  await expect(page.locator('.admin-user-row')).toHaveCount(1)
  const expand = page.getByRole('button', { name: 'Moreamoreceramics: üksikasjad' })
  await expand.click()
  const detail = page.getByRole('region', { name: 'Moreamoreceramics: ülevaade' })
  await expect(detail).toBeVisible()
  await expect(expand).toHaveAttribute('aria-expanded', 'true')
  await expect(detail.getByRole('meter')).toHaveAttribute('aria-valuenow', '6')
  await expect(detail.getByRole('group', { name: 'Müük päevade kaupa' }).getByRole('button')).toHaveCount(31)
  await detail.locator('summary').filter({ hasText: 'Viimane kiri' }).click()
  await expect(detail.getByText('Kinnita oma Poeruumi konto', { exact: true })).toBeVisible()
  await expect(detail.locator('summary').filter({ hasText: 'Konto' })).toContainText('Kinnitatud')
  await expect(detail.getByRole('link', { name: 'Ava pood' })).toHaveAttribute('target', '_blank')
  await detail.locator('summary').filter({ hasText: 'Viimane kiri' }).click()
  await page.screenshot({ path: 'output/admin-users-expanded.png', fullPage: true, animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(detail).not.toBeVisible()
  await expect(expand).toBeFocused()
  await page.getByRole('searchbox').fill('no-such-user')
  await expect(page.getByText('Kasutajaid ei leitud')).toBeVisible()
})

test('reply opens the exact support conversation without sending a message', async ({ page }) => {
  await installBackend(page)
  const markedRead: string[] = []
  const messagesSent: unknown[] = []
  await page.route('**/rpc/admin_support_conversations', (route) => route.fulfill({ json: [{
    id: 'conversation-test', user_id: users[4].user_id, email: users[4].email,
    origin: 'app', store_name: users[4].store_name, status: 'open', category: 'payments',
    subject: 'Maksete seadistamine', last_message_at: ago(1), created_at: ago(2),
    last_message_preview: 'Palun aidake maksetega.', is_unread: true,
  }] }))
  await page.route('**/support_messages?*', (route) => route.fulfill({ json: [{
    id: 'message-test', sender_kind: 'user', body: 'Palun aidake maksetega.',
    source: 'app', is_internal: false, created_at: ago(1),
  }] }))
  await page.route('**/rpc/mark_support_conversation_read', (route) => {
    markedRead.push(route.request().postDataJSON().target_conversation_id)
    return route.fulfill({ json: null })
  })
  await page.route('**/functions/v1/support-actions', (route) => {
    messagesSent.push(route.request().postDataJSON())
    return route.fulfill({ json: {} })
  })
  await page.goto('/admin/users')
  await page.getByRole('link', { name: 'Vasta 1', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/support\?conversation=conversation-test$/)
  await expect(page.getByRole('heading', { name: 'Maksete seadistamine', exact: true })).toBeVisible()
  await expect(page.locator('.admin-support__messages')).toContainText('Palun aidake maksetega.')
  await expect.poll(() => markedRead.includes('conversation-test')).toBe(true)
  expect(messagesSent).toEqual([])
})

test('realtime changes actual sales and presence without treating record updates as a sign-in', async ({ page }) => {
  const backend = await installBackend(page)
  await page.goto('/admin/users')
  await expect(page.locator('.admin-user-row')).toHaveCount(9)
  await expect.poll(() => backend.subscriptions.has('admin_dashboard_refresh')).toBe(true)
  const first = page.locator('.admin-user-row').first()
  await first.getByRole('button', { name: 'Angel Airshe: üksikasjad' }).click()
  await expect(first.getByRole('group', { name: 'Müük päevade kaupa' })).toBeVisible()
  const changed = structuredClone(users)
  changed[0].last_activity_at = ago(0)
  const metrics = structuredClone(userMetrics)
  metrics[0].paid_orders_30d = 1
  metrics[0].net_sales_30d_cents = 1200
  backend.setRows(changed)
  backend.setMetrics(metrics)
  backend.emit('admin_dashboard_refresh')
  await expect(page.getByRole('button', { name: 'Müügiga · 30 p', exact: true })).toContainText('4')
  await expect(first.locator('.admin-user-row__sales strong')).toContainText('12')
  await expect(first.locator('.user-insight-sales__numbers > strong')).toHaveText('12 €')
  await expect(first.getByRole('group', { name: 'Müük päevade kaupa' }).getByRole('button').first()).toHaveAccessibleName(/12\s€.*1 tasutud/)
  await expect(first.getByRole('button', { name: 'Angel Airshe: üksikasjad' })).toHaveAttribute('aria-expanded', 'true')
  await expect(first.locator('.admin-user-row__activity')).toHaveText('17 h tagasi')
  expect(await first.evaluate((element) => element.getAnimations().length)).toBeGreaterThan(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  backend.setOnline([users[0].user_id])
  backend.emit('user_presence_sessions')
  await expect(page.locator('.admin-users__online')).toContainText('1 ühendatud')
  await expect(first.locator('.admin-user-row__activity')).toHaveText('ÜhendatudVaade: Maksed')
  expect(await first.evaluate((element) => element.getAnimations().length)).toBe(0)
})

test('missing metrics are unknown, never substituted with legacy sales or misleading zeros', async ({ page }) => {
  const backend = await installBackend(page)
  backend.failMetrics(true)
  await page.goto('/admin/users')
  await expect(page.locator('.admin-user-row')).toHaveCount(9)
  await expect(page.getByRole('button', { name: 'Müügiga · 30 p', exact: true })).toBeDisabled()
  await expect(page.locator('.admin-user-row__sales strong')).toHaveText(Array(9).fill('—'))
  await expect(page.getByRole('link', { name: 'Vasta 1' })).toHaveCount(0)
  backend.failMetrics(false)
  await page.getByRole('button', { name: 'Proovi uuesti' }).click()
  await expect(page.getByRole('button', { name: 'Müügiga · 30 p', exact: true })).toBeEnabled()
  await expect(page.locator('.admin-user-row__sales strong').first()).toContainText('0')
})

test('responsive overview and expanded row remain usable by touch and keyboard', async ({ page }) => {
  await installBackend(page)
  await page.goto('/admin/users')
  await expect(page.locator('.admin-user-row')).toHaveCount(9)
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (width === 390) await page.screenshot({ path: 'output/admin-users-mobile.png', fullPage: true, animations: 'disabled' })
  }
  const published = page.getByRole('button', { name: 'Avalikud poed', exact: true })
  await published.focus()
  await page.keyboard.press('Enter')
  await expect(published).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.admin-user-row')).toHaveCount(4)
  await page.getByText('Filtrid', { exact: true }).click()
  await page.getByRole('button', { name: 'Ajutine e-post', exact: true }).click()
  await expect(page.locator('.admin-user-row')).toHaveCount(2)
  const toggle = page.getByRole('button', { name: 'testit: üksikasjad' })
  await toggle.click()
  const detail = page.getByRole('region', { name: 'testit: ülevaade' })
  await expect(detail).toBeVisible()
  await expect(detail.getByRole('group', { name: 'Müük päevade kaupa' })).toBeVisible()
  await detail.locator('summary').filter({ hasText: 'Maksed' }).click()
  await expect(detail.getByText('Ettevõtte juhtide andmed on puudu')).toBeVisible()
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (width <= 680) expect(await detail.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(width)
    if (width === 390) await page.screenshot({ path: 'output/admin-users-expanded-mobile.png', fullPage: true, animations: 'disabled' })
  }
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(detail).not.toBeVisible()
})


test('rows expand in place on a row click, isolate controls, and recover unavailable charts', async ({ page }) => {
  const backend = await installBackend(page)
  await page.goto('/admin/users')
  await expect(page.locator('.admin-user-row')).toHaveCount(9)
  expect(backend.insightRequests).toEqual([])
  const first = page.locator('.admin-user-row').first()
  await first.locator('.admin-user-row__store-state').click()
  const firstDetail = first.getByRole('region', { name: 'Angel Airshe: ülevaade' })
  await expect(firstDetail).toBeVisible()
  await expect(firstDetail.getByText('Veel müüki pole')).toBeVisible()
  await firstDetail.getByRole('heading', { name: 'Seadistus', exact: true }).click()
  await expect(firstDetail).toBeVisible()
  await first.locator('.admin-user-row__sales').click()
  await expect(firstDetail).not.toBeVisible()

  backend.failInsights(true)
  await page.getByRole('button', { name: 'Moreamoreceramics: üksikasjad' }).click()
  const detail = page.getByRole('region', { name: 'Moreamoreceramics: ülevaade' })
  await expect(detail.getByText('Graafik pole kättesaadav')).toBeVisible()
  await expect(detail.getByRole('group', { name: 'Müük päevade kaupa' })).toHaveCount(0)
  backend.failInsights(false)
  await detail.getByRole('button', { name: 'Proovi uuesti' }).click()
  const chart = detail.getByRole('group', { name: 'Müük päevade kaupa' })
  await expect(chart.getByRole('button')).toHaveCount(31)
  await chart.getByRole('button').last().focus()
  await page.keyboard.press('Home')
  await expect(chart.getByRole('button').first()).toBeFocused()
  await expect(detail.locator('output')).toContainText('121,50')
  await page.keyboard.press('ArrowRight')
  await expect(chart.getByRole('button').nth(1)).toBeFocused()
  await expect(detail.locator('output')).toContainText('0 €')
  await page.keyboard.press('Escape')
  await expect(detail).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Moreamoreceramics: üksikasjad' })).toBeFocused()
})

test('the whole page scrolls on mobile while desktop keeps navigation and controls in place', async ({ page }) => {
  await installBackend(page)
  await page.goto('/admin/users')
  const list = page.getByRole('region', { name: 'Kasutajate nimekiri', exact: true })
  await expect(page.locator('.admin-user-row')).toHaveCount(9)
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [390, 640], [844, 390]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => window.scrollTo(0, 0))
    await list.evaluate((element) => { element.scrollTop = 0 })
    if (width <= 680) {
      await page.locator('.admin-user-row').first().hover()
      await page.mouse.wheel(0, 700)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
      expect(await list.evaluate((element) => element.scrollTop)).toBe(0)
      await expect(page.locator('.admin-users__metrics')).not.toBeInViewport()
      await expect(page.locator('.admin-sidebar')).not.toBeInViewport()
      await page.screenshot({ path: `output/admin-users-mobile-scroll-${height}.png`, animations: 'disabled' })
      await page.getByRole('button', { name: 'URGITS', exact: true }).scrollIntoViewIfNeeded()
      await expect(page.getByRole('button', { name: 'URGITS', exact: true })).toBeInViewport()
      await page.getByRole('button', { name: 'URGITS: üksikasjad' }).click()
      const detail = page.getByRole('region', { name: 'URGITS: ülevaade' })
      await detail.locator('summary').filter({ hasText: 'Viimane kiri' }).click()
      await detail.getByText('Kinnita oma Poeruumi konto', { exact: true }).scrollIntoViewIfNeeded()
      await expect(detail.getByText('Kinnita oma Poeruumi konto', { exact: true })).toBeInViewport()
      expect(await list.evaluate((element) => element.scrollTop)).toBe(0)
      await page.keyboard.press('Escape')
      await page.getByRole('searchbox').fill('ceramics')
      await expect(page.locator('.admin-user-row')).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'Moreamoreceramics', exact: true })).toBeInViewport()
      await page.getByRole('searchbox').fill('')
      continue
    }
    const fixed = page.locator('.admin-sidebar, .admin-users > header, .admin-users__metrics, .admin-users__toolbar')
    const before = await fixed.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top))
    const box = (await list.boundingBox())!
    expect(box.height).toBeGreaterThan(140)
    expect(box.y + box.height).toBeLessThanOrEqual(height)
    await list.hover()
    await page.mouse.wheel(0, 700)
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    expect(await fixed.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top))).toEqual(before)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    if (width > 680) {
      const header = (await page.locator('.admin-table__head').boundingBox())!
      expect(Math.abs(header.y - box.y)).toBeLessThanOrEqual(2)
    }
    await list.evaluate((element) => { element.scrollTop = 0 })
    await list.focus()
    await page.keyboard.press('PageDown')
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await list.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect(page.locator('.admin-user-row').last(), `Last row at ${width} × ${height}`).toBeInViewport()
    await page.getByRole('button', { name: 'URGITS', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'URGITS', exact: true })).toBeInViewport()
    await page.getByRole('searchbox').fill('ceramics')
    await expect(page.locator('.admin-user-row')).toHaveCount(1)
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0)
    await page.getByRole('button', { name: 'Moreamoreceramics: üksikasjad' }).click()
    const detail = page.getByRole('region', { name: 'Moreamoreceramics: ülevaade' })
    await expect(detail.getByRole('group', { name: 'Müük päevade kaupa' })).toBeVisible()
    await detail.locator('summary').filter({ hasText: 'Viimane kiri' }).click()
    await detail.getByText('Kinnita oma Poeruumi konto', { exact: true }).scrollIntoViewIfNeeded()
    await expect(detail.getByText('Kinnita oma Poeruumi konto', { exact: true })).toBeInViewport()
    expect(await fixed.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top))).toEqual(before)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await detail.locator('summary').filter({ hasText: 'Viimane kiri' }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('searchbox').fill('')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await page.screenshot({ path: 'output/admin-users-scroll-fixed.png', animations: 'disabled' })
})
