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

async function installOverviewData(page: Page) {
  let mode: 'ready' | 'error' | 'zero' | 'empty' = 'ready'
  let added = 0
  let addedAccounts = 0
  let pendingResponse: Promise<void> | null = null
  const requestedRanges: number[] = []
  await page.route('**/rpc/admin_homepage_analytics', async (route) => {
    const days = route.request().postDataJSON().requested_days
    requestedRanges.push(days)
    if (mode === 'error') return route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    const daily = mode === 'empty' ? [] : Array.from({ length: days }, (_, i) => ({
      date: new Date(now - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
      sessions: mode === 'zero' ? 0 : i + 1 + (i === days - 1 ? added : 0),
      signup_starts: mode === 'zero' ? 0 : i % 3 + (i === days - 1 ? added : 0),
      accounts_created: mode === 'zero' ? 0 : i % 2 + (i === days - 1 ? addedAccounts : 0),
    }))
    if (pendingResponse) await pendingResponse
    return route.fulfill({ json: {
      range_days: days, daily,
      sessions: daily.reduce((sum, day) => sum + day.sessions, 0),
      signup_starts: daily.reduce((sum, day) => sum + day.signup_starts, 0),
      accounts_created: daily.reduce((sum, day) => sum + day.accounts_created, 0),
    } })
  })
  await page.route('**/rpc/admin_homepage_engagement', (route) => route.fulfill({ json: {} }))
  await page.route('**/rpc/admin_revenue_dashboard', (route) => mode === 'error'
    ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    : route.fulfill({ json: {
      month_total_cents: mode === 'ready' ? 37540 : 0,
      today_total_cents: mode === 'ready' ? 2120 : 0,
      subscription_total_cents: mode === 'ready' ? 29900 : 0,
      transaction_fee_total_cents: mode === 'ready' ? 8640 : 0,
      refund_total_cents: mode === 'ready' ? -1000 : 0,
      recent_events: mode === 'ready' ? [{ id: 'revenue-1', kind: 'transaction_fee', amount_cents: 780, currency: 'eur', description: '4% müügitasu + käibemaks', occurred_at: ago(1), store_id: 'store-3', store_name: 'Moreamoreceramics' }] : [],
    } }))
  return {
    requestedRanges,
    setMode: (next: typeof mode) => { mode = next },
    setAdded: (value: number) => { added = value },
    setAddedAccounts: (value: number) => { addedAccounts = value },
    holdResponse: () => {
      let release!: () => void
      pendingResponse = new Promise<void>((resolve) => { release = resolve })
      return () => { pendingResponse = null; release() }
    },
  }
}

async function installFeedbackAudio(page: Page) {
  await page.addInitScript(() => {
    const native = window.AudioContext
    const stats = { contexts: 0, tones: 0, closed: 0, notes: [] as { frequency: number; at: number }[] }
    ;(window as any).__visitAudio = stats
    window.AudioContext = class extends native {
      constructor() { super(); stats.contexts++ }
      createOscillator() {
        const oscillator = super.createOscillator()
        const start = oscillator.start.bind(oscillator)
        oscillator.start = (when?: number) => {
          stats.tones++
          stats.notes.push({ frequency: oscillator.frequency.value, at: when ?? 0 })
          start(when)
        }
        return oscillator
      }
      close() { stats.closed++; return super.close() }
    }
  })
  return () => page.evaluate(() => (window as any).__visitAudio as {
    contexts: number; tones: number; closed: number; notes: { frequency: number; at: number }[]
  })
}

test('homepage visits highlight increases, clear the badge, and ignore unchanged totals and period changes', async ({ page }) => {
  await installBackend(page)
  const backend = await installOverviewData(page)
  await page.goto('/admin')
  const headline = page.locator('.overview-traffic__headline > strong')
  const badge = page.locator('.visit-feedback__badge')
  const panel = page.getByRole('region', { name: 'Avalehe külastatavus' })
  await expect(headline).toHaveText('465')
  await expect(badge).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Külastuste ja uute kontode heli' })).toHaveAttribute('aria-pressed', 'false')
  backend.setAdded(1)
  await page.clock.fastForward(15_000)
  await expect(headline).toHaveText('466')
  await expect(badge).toHaveText('+1 uus külastus')
  await expect(panel).toHaveClass(/has-new-visits/)
  await expect(headline.locator('.visit-feedback__number')).toHaveClass(/is-new/)
  await page.clock.fastForward(3300)
  await expect(badge).toHaveCount(0)
  await expect(panel).not.toHaveClass(/has-new-visits/)
  await page.clock.fastForward(15_000)
  await expect.poll(() => backend.requestedRanges.length).toBe(3)
  await expect(badge).toHaveCount(0)
  backend.setAdded(5)
  await page.clock.fastForward(15_000)
  await expect(badge).toHaveText('+4 uut külastust')
  await page.getByRole('button', { name: '90 p', exact: true }).click()
  await expect(headline).toHaveText('4100')
  await expect(badge).toHaveCount(0)
  backend.setAdded(0)
  await page.clock.fastForward(15_000)
  await expect(headline).toHaveText('4095')
  await expect(badge).toHaveCount(0)
  backend.setAdded(2)
  await page.clock.fastForward(15_000)
  await expect(badge).toHaveText('+2 uut külastust')
})

test('homepage visit sound is opt-in, plays once per update, follows navigation and stops when muted', async ({ page }) => {
  await installBackend(page)
  const backend = await installOverviewData(page)
  const stats = await installFeedbackAudio(page)
  await page.goto('/admin')
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('465')
  backend.setAdded(1)
  await page.clock.fastForward(15_000)
  await expect(page.locator('.visit-feedback__badge')).toBeVisible()
  expect(await stats()).toMatchObject({ contexts: 0, tones: 0, closed: 0 })
  const toggle = page.getByRole('button', { name: 'Külastuste ja uute kontode heli' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(await stats()).toMatchObject({ contexts: 1, tones: 2 })
  backend.setAdded(4)
  await page.clock.fastForward(15_000)
  await expect(page.locator('.visit-feedback__badge')).toHaveText('+3 uut külastust')
  expect(await stats()).toMatchObject({ tones: 4 })
  await page.clock.fastForward(15_000)
  await expect(page.locator('.visit-feedback__badge')).toHaveCount(0)
  expect(await stats()).toMatchObject({ tones: 4 })
  await page.getByRole('button', { name: '90 p', exact: true }).click()
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('4099')
  expect(await stats()).toMatchObject({ tones: 4 })
  await page.getByRole('link', { name: 'Ava külastatavuse üksikasjad' }).click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  backend.setAdded(5)
  await page.clock.fastForward(15_000)
  await expect(page.locator('.admin-analytics__kpis .visit-feedback__badge')).toHaveText('+1 uus külastus')
  expect(await stats()).toMatchObject({ tones: 6 })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(await stats()).toMatchObject({ closed: 1 })
  backend.setAdded(6)
  await page.clock.fastForward(15_000)
  await expect(page.locator('.admin-analytics__kpis article').first().locator('strong')).toHaveText('4101')
  expect(await stats()).toMatchObject({ tones: 6 })
})

test('new accounts have their own badge and melody, with sequential sounds for simultaneous visits', async ({ page }, testInfo) => {
  await installBackend(page)
  const backend = await installOverviewData(page)
  const stats = await installFeedbackAudio(page)
  await page.goto('/admin')
  const headline = page.locator('.overview-traffic__headline > strong')
  const accounts = page.getByRole('button', { name: /Uued kontod/ })
  const accountBadge = page.locator('.visit-feedback__badge[data-kind="account"]')
  const toggle = page.getByRole('button', { name: 'Külastuste ja uute kontode heli' })
  await expect(headline).toHaveText('465')
  await expect(accounts.locator('strong')).toHaveText('15')
  await expect(accountBadge).toHaveCount(0)
  backend.setAddedAccounts(1)
  await page.clock.fastForward(15_000)
  await expect(accounts.locator('strong')).toHaveText('16')
  await expect(accounts).toHaveClass(/has-new-accounts/)
  await expect(accountBadge).toHaveText('+1 uus konto')
  await expect(headline).toHaveText('465')
  expect(await stats()).toMatchObject({ contexts: 0, tones: 0 })
  await page.locator('.overview-traffic').screenshot({ path: testInfo.outputPath('new-account-desktop.png') })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  backend.setAddedAccounts(3)
  await page.clock.fastForward(15_000)
  await expect(accountBadge).toHaveText('+2 uut kontot')
  const accountSound = await stats()
  expect(accountSound.tones).toBe(5)
  expect(accountSound.notes.slice(0, 2).map(note => note.frequency)).toEqual([660, 880])
  expect(accountSound.notes.slice(2).map(note => Math.round(note.frequency))).toEqual([523, 659, 784])
  await page.clock.fastForward(3300)
  await expect(accountBadge).toHaveCount(0)
  await page.clock.fastForward(15_000)
  expect(await stats()).toMatchObject({ tones: 5 })
  await page.getByRole('button', { name: '90 p', exact: true }).click()
  await expect(accounts.locator('strong')).toHaveText('48')
  await expect(accountBadge).toHaveCount(0)
  expect(await stats()).toMatchObject({ tones: 5 })

  backend.setAdded(2)
  backend.setAddedAccounts(4)
  await page.clock.fastForward(15_000)
  await expect(accountBadge).toHaveText('+1 uus konto')
  await expect(page.locator('.visit-feedback__badge[data-kind="visit"]')).toHaveText('+2 uut külastust')
  const combinedSound = await stats()
  expect(combinedSound.tones).toBe(10)
  const notes = combinedSound.notes.slice(-5)
  expect(notes.map(note => Math.round(note.frequency))).toEqual([660, 880, 523, 659, 784])
  expect(notes[2].at).toBeGreaterThan(notes[1].at + .24)
  await accounts.click()
  await expect(headline).toHaveText('49')
  await expect(page.locator('.overview-traffic__headline .visit-feedback__badge')).toHaveText('+1 uus konto')
  expect(await stats()).toMatchObject({ tones: 10 })

  await page.getByRole('link', { name: 'Ava külastatavuse üksikasjad' }).click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  // A rolling-window decrease in visits must not swallow a new account.
  backend.setAdded(0)
  backend.setAddedAccounts(5)
  await page.clock.fastForward(15_000)
  await expect(page.locator('.admin-analytics__funnel .visit-feedback__badge')).toHaveText('+1 uus konto')
  expect(await stats()).toMatchObject({ tones: 13 })
  backend.setAddedAccounts(0)
  await page.clock.fastForward(15_000)
  await expect(accountBadge).toHaveCount(0)
  expect(await stats()).toMatchObject({ tones: 13 })
  await toggle.click()
  backend.setAddedAccounts(1)
  await page.clock.fastForward(15_000)
  await expect(accountBadge).toHaveText('+1 uus konto')
  expect(await stats()).toMatchObject({ tones: 13, closed: 1 })
})

test('homepage visit feedback remains usable on mobile with reduced motion and unavailable audio', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installBackend(page)
  const backend = await installOverviewData(page)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: class { constructor() { throw new Error('Unavailable audio') } } })
  })
  await page.goto('/admin')
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('465')
  const toggle = page.getByRole('button', { name: 'Külastuste ja uute kontode heli' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('alert')).toHaveText('Heli ei saanud sisse lülitada. Proovi uuesti.')
  expect((await page.getByRole('alert').boundingBox())!.x).toBeGreaterThanOrEqual(0)
  backend.setAdded(2)
  await page.clock.fastForward(15_000)
  await expect(page.locator('.visit-feedback__badge')).toHaveText('+2 uut külastust')
  expect(await page.locator('.overview-traffic__headline .visit-feedback__number').evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  expect(await page.locator('.visit-feedback__badge').evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('visits-mobile.png') })
  backend.setAddedAccounts(1)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const accountBadge = page.locator('.visit-feedback__badge[data-kind="account"]')
  await expect(accountBadge).toHaveText('+1 uus konto')
  expect(await accountBadge.evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.locator('.overview-traffic').screenshot({ path: testInfo.outputPath('new-account-mobile.png') })
  await page.getByRole('link', { name: 'Ava külastatavuse üksikasjad' }).click()
  await expect(toggle).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('homepage analytics refreshes silently without overlapping requests and recovers from failures', async ({ page }) => {
  await installBackend(page)
  const backend = await installOverviewData(page)
  await page.goto('/admin')
  const chart = page.getByRole('slider', { name: 'Külastused päevade kaupa' })
  const headline = page.locator('.overview-traffic__headline > strong')
  await expect(headline).toHaveText('465')
  await chart.focus()
  await page.keyboard.press('End')
  backend.setAdded(5)
  backend.setAddedAccounts(5)
  const release = backend.holdResponse()
  await page.clock.fastForward(15_000)
  await expect.poll(() => backend.requestedRanges.length).toBe(2)
  await expect(headline).toHaveText('465')
  await expect(chart).toBeFocused()
  await expect(page.getByRole('region', { name: 'Avalehe külastatavus' })).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('button', { name: '7 p', exact: true })).toBeEnabled()
  await page.clock.fastForward(15_000)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(backend.requestedRanges).toEqual([30, 30])
  release()
  await expect(headline).toHaveText('470')
  await expect(chart).toBeFocused()
  await expect(chart).toHaveAttribute('aria-valuetext', '1. okt: 35 külastused')
  await expect(page.getByRole('button', { name: 'Alustamised' })).toContainText('35')
  await expect(page.getByRole('button', { name: 'Uued kontod' })).toContainText('20')

  backend.setMode('error')
  await page.clock.fastForward(15_000)
  await expect.poll(() => backend.requestedRanges.length).toBe(3)
  await expect(headline).toHaveText('470')
  await expect(chart).toBeVisible()
  await expect(page.getByText('Graafik pole praegu saadaval')).toHaveCount(0)
  backend.setMode('ready')
  backend.setAdded(9)
  await page.clock.fastForward(15_000)
  await expect(headline).toHaveText('474')
})

test('homepage analytics pauses while hidden, offline or in another view and refreshes on return', async ({ page }) => {
  await installBackend(page)
  const backend = await installOverviewData(page)
  await page.goto('/admin')
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('465')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(45_000)
  expect(backend.requestedRanges).toEqual([30])
  backend.setAdded(1)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('466')
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }))
  await page.clock.fastForward(30_000)
  expect(backend.requestedRanges).toEqual([30, 30])
  backend.setAdded(2)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
  })
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('467')
  await page.getByRole('link', { name: 'Kasutajad', exact: true }).click()
  await expect(page.locator('.admin-user-row')).toHaveCount(9)
  await page.clock.fastForward(30_000)
  expect(backend.requestedRanges).toEqual([30, 30, 30])
  backend.setAdded(3)
  await page.getByRole('link', { name: 'Ülevaade', exact: true }).click()
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('468')
  backend.setAdded(4)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('469')
})

test('homepage analytics ignores an older background response after changing periods', async ({ page }) => {
  await installBackend(page)
  const backend = await installOverviewData(page)
  await page.goto('/admin')
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('465')
  const release = backend.holdResponse()
  await page.clock.fastForward(15_000)
  await expect.poll(() => backend.requestedRanges.length).toBe(2)
  await page.getByRole('button', { name: '7 p', exact: true }).click()
  await expect.poll(() => backend.requestedRanges).toEqual([30, 30, 7])
  release()
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('28')
  backend.setAdded(1)
  await page.clock.fastForward(15_000)
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('29')
  expect(backend.requestedRanges).toEqual([30, 30, 7, 7])
  await page.getByRole('link', { name: 'Ava külastatavuse üksikasjad' }).click()
  backend.setAdded(2)
  await page.clock.fastForward(15_000)
  await expect(page.locator('.admin-analytics__kpis article').first().locator('strong')).toHaveText('30')
  backend.setAdded(3)
  await page.getByRole('button', { name: 'Uuenda andmeid' }).click()
  await expect(page.locator('.admin-analytics__kpis article').first().locator('strong')).toHaveText('31')
})

test('homepage analytics retries an initial error in the background', async ({ page }) => {
  await installBackend(page)
  const backend = await installOverviewData(page)
  backend.setMode('error')
  await page.goto('/admin')
  await expect(page.getByText('Graafik pole praegu saadaval')).toBeVisible()
  backend.setMode('ready')
  await page.clock.fastForward(15_000)
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('465')
  await expect(page.getByRole('slider', { name: 'Külastused päevade kaupa' })).toBeVisible()
})

test('dashboard charts inspect real daily values, switch metrics and request the selected period', async ({ page }) => {
  await installBackend(page)
  const backend = await installOverviewData(page)
  await page.goto('/admin')
  const chart = page.getByRole('slider', { name: 'Külastused päevade kaupa' })
  await expect(chart).toBeVisible()
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('465')
  await expect(page.locator('.overview-stores__legend')).toContainText('Avalikud4')
  await expect(page.locator('.overview-stores__legend')).toContainText('Seadistamisel4')
  await expect(page.locator('.overview-stores__legend')).toContainText('Pood loomata1')
  await chart.focus()
  await page.keyboard.press('Home')
  await expect(chart).toHaveAttribute('aria-valuenow', '1')
  await expect(chart).toHaveAttribute('aria-valuetext', '2. sept: 1 külastused')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.overview-chart__readout')).toHaveText('3. sept2külastused')
  await page.keyboard.press('End')
  await expect(chart).toHaveAttribute('aria-valuetext', '1. okt: 30 külastused')
  await page.getByRole('button', { name: 'Alustamised', exact: false }).click()
  const starts = page.getByRole('slider', { name: 'Alustamised päevade kaupa' })
  await expect(starts).toBeVisible()
  await starts.focus()
  await page.keyboard.press('End')
  await expect(starts).toHaveAttribute('aria-valuetext', '1. okt: 2 alustamised')
  await page.getByRole('button', { name: '7 p', exact: true }).click()
  await expect(starts).toHaveAttribute('aria-valuemax', '7')
  expect(backend.requestedRanges).toEqual([30, 7])
  await page.getByRole('button', { name: 'Külastused', exact: false }).click()
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('28')
  await expect(page.locator('.overview-income__amount')).toHaveText('375,40 €')
  await expect(page.locator('.overview-income__breakdown')).toContainText('Tagastused−10 €')
  await expect(page.getByText('Moreamoreceramics', { exact: true })).not.toBeVisible()
  await page.locator('.overview-receipts summary').click()
  await expect(page.getByText('Moreamoreceramics', { exact: true })).toBeVisible()
  await expect(page.locator('.overview-receipts')).toContainText('+7,80 €')
  await page.getByRole('link', { name: 'Ava külastatavuse üksikasjad' }).click()
  await expect(page).toHaveURL(/\/admin\/analytics$/)
  await expect(page.getByRole('combobox', { name: 'Ajavahemik' })).toHaveValue('7')
})

test('revenue keeps amounts and receipts visible during background refreshes', async ({ page }) => {
  await installBackend(page)
  await installOverviewData(page)
  await page.goto('/admin')
  const income = page.getByRole('region', { name: 'Poeruumi teenustasud' })
  const amount = income.locator('.overview-income__amount')
  await expect(amount).toHaveText('375,40 €')
  await income.locator('.overview-receipts summary').click()
  const receipt = income.locator('.overview-receipts li')
  await expect(receipt).toHaveCount(1)
  const previousText = await income.innerText()
  const previousComposition = await income.locator('.overview-income__composition').innerHTML()
  const pending: Route[] = []
  await page.route('**/rpc/admin_revenue_dashboard', route => { pending.push(route) })

  await page.clock.fastForward(60_000)
  await expect.poll(() => pending.length).toBe(1)
  await expect(income).toHaveAttribute('aria-busy', 'false')
  expect(await income.innerText()).toBe(previousText)
  expect(await income.locator('.overview-income__composition').innerHTML()).toBe(previousComposition)
  await expect(receipt).toBeVisible()
  await expect(income).not.toHaveClass(/is-live-update/)
  await pending[0].fulfill({ json: {
    month_total_cents: 38540, today_total_cents: 3120,
    subscription_total_cents: 29900, transaction_fee_total_cents: 9640, refund_total_cents: -1000,
    recent_events: [{ id: 'revenue-2', kind: 'transaction_fee', amount_cents: 1000, currency: 'eur',
      description: 'Müügitasu', occurred_at: ago(0), store_id: 'store-3', store_name: 'Moreamoreceramics' }],
  } })
  await expect(amount).toHaveText('385,40 €')
  await expect(receipt).toContainText('+10 €')

  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => pending.length).toBe(2)
  await expect(amount).toHaveText('385,40 €')
  const failedResponse = page.waitForResponse(response => response.url().includes('/rpc/admin_revenue_dashboard') && response.status() === 503)
  await pending[1].fulfill({ status: 503, json: { message: 'Unavailable' } })
  await failedResponse
  await page.clock.runFor(100)
  await expect(income.getByRole('alert')).toHaveCount(0)
  await expect(amount).toHaveText('385,40 €')
  await expect(receipt).toBeVisible()

  await page.clock.fastForward(60_000)
  await expect.poll(() => pending.length).toBe(3)
  await expect(amount).toHaveText('385,40 €')
  await pending[2].fulfill({ json: {
    month_total_cents: 0, today_total_cents: 0, subscription_total_cents: 0,
    transaction_fee_total_cents: 0, refund_total_cents: 0, recent_events: [],
  } })
  await expect(amount).toHaveText('0 €')
  await expect(income.getByText('Laekumisi veel pole')).toBeVisible()
})

test('dashboard distinguishes failed data, measured zeroes and missing daily data', async ({ page }) => {
  await installBackend(page)
  const backend = await installOverviewData(page)
  backend.setMode('error')
  await page.goto('/admin')
  await expect(page.getByText('Graafik pole praegu saadaval')).toBeVisible()
  await expect(page.getByText('Tulu pole praegu saadaval')).toBeVisible()
  await expect(page.locator('.overview-income__amount')).toHaveText('—')
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('—')
  await expect(page.getByRole('slider')).toHaveCount(0)
  backend.setMode('zero')
  await page.reload()
  await expect(page.locator('.overview-income__amount')).toHaveText('0 €')
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('0')
  const chart = page.getByRole('slider', { name: 'Külastused päevade kaupa' })
  await chart.focus()
  await page.keyboard.press('End')
  await expect(chart).toHaveAttribute('aria-valuetext', '1. okt: 0 külastused')
  backend.setMode('empty')
  await page.reload()
  await expect(page.getByText('Päevased andmed puuduvad')).toBeVisible()
  await expect(page.getByRole('slider')).toHaveCount(0)
  await page.locator('.overview-receipts summary').click()
  await expect(page.getByText('Laekumisi veel pole')).toBeVisible()
})

test.describe('dashboard on touchscreens', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  test('tap selects a day and the whole page scrolls at narrow widths', async ({ page }) => {
    await installBackend(page)
    await installOverviewData(page)
    await page.goto('/admin')
    const chart = page.getByRole('slider', { name: 'Külastused päevade kaupa' })
    await expect(chart).toBeVisible()
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await chart.scrollIntoViewIfNeeded()
      const box = (await chart.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
      await expect(chart).toHaveAttribute('aria-valuenow', '16')
      await expect(page.locator('.overview-chart__readout')).toContainText('16')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      const support = page.locator('.overview-attention__item').last()
      await support.scrollIntoViewIfNeeded()
      await expect(support).toBeInViewport()
      expect(await page.evaluate(() => scrollY)).toBeGreaterThan(500)
    }
    await page.locator('.overview-attention__item').last().tap()
    await expect(page).toHaveURL(/\/admin\/support$/)
  })
})

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
