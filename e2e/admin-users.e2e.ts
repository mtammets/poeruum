import { expect, test, type Page, type Route, type WebSocketRoute } from '@playwright/test'
import type { PaymentDiagnostics } from '../shared/paymentDiagnostics'

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

function paymentFixture(index: number, source: 'saved' | 'stripe' = 'saved', changes: Partial<PaymentDiagnostics> = {}): PaymentDiagnostics {
  const row = users[index]
  const restricted = [1, 4, 7].includes(index)
  return {
    version: 1, userId: row.user_id, storeId: row.store_id!, source, checkedAt: ago(1), connected: Boolean(row.store_id), mode: 'live',
    chargesEnabled: !restricted, payoutsEnabled: !restricted, detailsSubmitted: true, identityError: null, setupError: null,
    disabledReason: restricted ? 'requirements.past_due' : null, pendingVerification: false, dueCount: restricted ? 1 : 0,
    dueFields: source === 'saved' ? null : restricted ? ['company.directors_provided'] : [], pendingFields: [], futureFields: [], deadline: null,
    issues: row.stripe_account_requirement_issues.map((issue) => ({ code: issue.code, requirement: issue.requirement })),
    dashboardUrl: 'https://dashboard.stripe.com/connect/accounts/acct_fixture', ...changes,
  }
}

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
    if (path.endsWith('/functions/v1/admin-payment-status')) {
      const body = route.request().postDataJSON()
      if (body.action === 'snapshot') return json(route, { diagnostics: users.flatMap((row, index) => row.store_id && body.userIds.includes(row.user_id) ? [paymentFixture(index)] : []) })
      const index = users.findIndex((row) => row.user_id === body.userId)
      return index < 0 ? route.fulfill({ status: 404, json: { error: 'Poodi ei leitud.' } }) : json(route, { diagnostic: paymentFixture(index, 'stripe') })
    }
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
    disconnect: () => socket!.close({ code: 1012, reason: 'Test reconnect' }),
    emit: (table: string, record: Record<string, unknown> = { id: true }, type = 'UPDATE') => {
      const channel = subscriptions.get(table)!
      socket!.send(JSON.stringify([channel.joinRef, null, channel.topic, 'postgres_changes', {
        ids: [channel.id], data: { schema: 'public', table, type, commit_timestamp: new Date(now).toISOString(), columns: [], record, old_record: {} },
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

async function installAttractionData(page: Page) {
  let mode: 'ready' | 'zero' | 'empty' | 'error' = 'ready'
  let comparison = true
  let added = 0
  let pendingResponse: Promise<void> | null = null
  const ranges: number[] = []
  const metrics = (clicks: number, impressions: number) => ({ visits: impressions, impressions, store_clicks: clicks, product_clicks: 0, outbound_visits: clicks, searches: 0, empty_searches: 0, average_position: null, ctr: impressions ? clicks / impressions * 100 : null })
  await page.route('**/rpc/admin_directory_analytics', async (route) => {
    const days = route.request().postDataJSON().requested_days
    ranges.push(days)
    if (mode === 'error') return route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    const factor = days === 7 ? 1 : 2
    const shops = [
      { name: 'Keraamika Stuudio', clicks: 24 + added, previous: 12, impressions: 96 },
      { name: 'Põhjala Puit', clicks: 8, previous: 16, impressions: 80 },
      { name: 'Ehtepood', clicks: 4, previous: 4, impressions: 40 },
      { name: 'Linane', clicks: 0, previous: 2, impressions: 0 },
    ]
    const report = {
      range_days: days, from_date: '2026-09-25', to_date: '2026-10-01', previous_from_date: '2026-09-18', previous_to_date: '2026-09-24',
      tracking_started_at: '2026-09-01T00:00:00Z', comparison_available: comparison, store: null,
      current: metrics(mode === 'ready' ? (36 + added) * factor : 0, mode === 'ready' ? 216 * factor : 0), previous: metrics(34, 200), daily: [],
      stores: mode === 'empty' ? [] : shops.map((store, index) => ({ id: `attraction-${index}`, name: store.name, slug: null, is_published: true, position: index + 1,
        current: metrics(mode === 'ready' ? store.clicks * factor : 0, mode === 'ready' ? store.impressions * factor : 0), previous: metrics(store.previous, 80) })),
      sources: [], devices: [], products: [], placements: [],
    }
    if (pendingResponse) await pendingResponse
    return route.fulfill({ json: report })
  })
  return {
    ranges, setMode: (next: typeof mode) => { mode = next }, setComparison: (next: boolean) => { comparison = next }, setAdded: (value: number) => { added = value },
    holdResponse: () => {
      let release!: () => void
      pendingResponse = new Promise<void>((resolve) => { release = resolve })
      return () => { pendingResponse = null; release() }
    },
  }
}

async function installTrafficData(page: Page) {
  let mode: 'ready' | 'zero' | 'unmeasured' | 'error' = 'ready'
  let added = 0
  const ranges: number[] = []
  const dailyCounts = [14, 21, 18, 16, 22, 7, 9, 24, 20, 26, 31, 13, 12, 28, 36, 32, 27, 18, 22, 34, 30, 39, 28, 19, 23, 41, 35, 31, 45, 57]
  await page.route('**/rpc/admin_homepage_analytics', (route) => {
    const days = route.request().postDataJSON().requested_days
    ranges.push(days)
    if (mode === 'error') return route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    const daily = Array.from({ length: days }, (_, i) => ({ date: new Date(now - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10), sessions: mode === 'zero' ? 0 : dailyCounts[i % 30] + (i === days - 1 ? added : 0), signup_starts: mode === 'zero' ? 0 : i % 3, accounts_created: mode === 'zero' ? 0 : i % 5 === 0 ? 1 : 0 }))
    const sessions = daily.reduce((sum, row) => sum + row.sessions, 0)
    return route.fulfill({ json: { range_days: days, daily, sessions, anonymous_sessions: Math.max(0, sessions - 56), merchant_sessions: mode === 'zero' ? 0 : 56,
      signup_starts: mode === 'zero' ? 0 : 25, tracked_accounts: 4, accounts_created: mode === 'zero' ? 0 : 6, stores_started: mode === 'zero' ? 0 : 5, payments_connected: mode === 'zero' ? 0 : 2, stores_published: mode === 'zero' ? 0 : 1, demo_opens: mode === 'zero' ? 0 : 7, pricing_views: mode === 'zero' ? 0 : 18,
      devices: mode === 'zero' ? [] : [{ device: 'mobile', sessions: 464 }, { device: 'desktop', sessions: 240 }, { device: 'tablet', sessions: 20 }],
      ctas: mode === 'zero' ? [] : [{ label: 'hero', sessions: 17 }, { label: 'nav', sessions: 6 }, { label: 'pricing_fixed', sessions: 2 }],
      faqs: mode === 'zero' ? [] : [{ label: 'pricing', sessions: 12 }, { label: 'payments', sessions: 8 }, { label: 'shipping', sessions: 3 }],
    } })
  })
  await page.route('**/rpc/admin_homepage_engagement', (route) => {
    const empty = mode === 'zero' || mode === 'unmeasured'
    return route.fulfill({ json: { measured_sessions: empty ? 0 : 724, engaged_sessions: empty ? 0 : 138, average_engaged_seconds: empty ? 0 : 16,
      engagement_buckets: empty ? [] : [{ bucket: 'under_10', sessions: 586 }, { bucket: '10_29', sessions: 80 }, { bucket: '30_119', sessions: 45 }, { bucket: '120_plus', sessions: 13 }],
      sources: mode === 'zero' ? [] : ['google.com', 'Otse', 'facebook.com', 'instagram.com', 'uudiskiri', 'bing.com'].map((source, i) => ({ source, sessions: [330, 180, 92, 72, 30, 20][i], measured_sessions: empty ? 0 : 20, engaged_sessions: empty ? 0 : 5, average_engaged_seconds: empty ? 0 : 12 + i * 5 })),
    } })
  })
  return { ranges, total: dailyCounts.reduce((sum, count) => sum + count, 0), setAdded: (n: number) => { added = n }, setMode: (next: typeof mode) => { mode = next } }
}

test('visual traffic dashboard shows real metrics, explores charts, and reveals definitions on demand', async ({ page }) => {
  await installBackend(page)
  const backend = await installTrafficData(page)
  await page.goto('/admin/analytics')
  await expect(page.locator('.traffic-hero__headline > strong')).toHaveText(String(backend.total))
  await expect(page.getByRole('button', { name: 'Vähemalt 10 sekundit aktiivsed: 19,1%' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Keskmine aktiivne aeg: 16 s' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Neist avaldatud poega kontod: 1, 16,7%' })).toBeVisible()
  await expect(page.locator('.traffic-ranking > button')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Mobiil: 64,1%' })).toBeVisible()
  // No explanatory paragraphs compete with the charts in the main view.
  await expect(page.locator('.traffic-dashboard p')).toHaveCount(0)
  await page.getByRole('button', { name: 'Kontode edenemise selgitus' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAccessibleName('Uute kontode edenemine')
  await expect(dialog).toContainText('ei tõenda sammude läbimise järjekorda')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Kontode edenemise selgitus' })).toBeFocused()
  const metricPicker = page.getByRole('group', { name: 'Trendi näitaja' })
  await metricPicker.getByRole('button', { name: 'Alustamised' }).click()
  await expect(page.locator('.traffic-hero__headline > strong')).toHaveText('25')
  const chart = page.getByRole('slider', { name: 'Alustamised päevade kaupa' })
  await chart.focus()
  await page.keyboard.press('Home')
  await expect(chart).toHaveAttribute('aria-valuetext', '2. sept: 0 alustamised')
  await page.keyboard.press('ArrowRight')
  await expect(chart).toHaveAttribute('aria-valuetext', '3. sept: 1 alustamised')
  await page.getByRole('group', { name: 'Jaotuse valik' }).getByRole('button', { name: 'Küsimused' }).click()
  await expect(page.locator('.traffic-ranking__name').first()).toHaveText('Hind')
  await page.getByRole('button', { name: 'Hind: 12, 52,2%' }).click()
  await expect(dialog).toContainText('Üks sessioon võib avada mitu küsimust')
  await dialog.getByRole('button', { name: 'Sulge üksikasjad' }).click()
  await page.getByRole('group', { name: 'Jaotuse valik' }).getByRole('button', { name: 'Alustamised' }).click()
  await expect(page.locator('.traffic-ranking__name').first()).toHaveText('Avalehe algus')
  await page.getByRole('group', { name: 'Ajavahemik' }).getByRole('button', { name: '90 päeva' }).click()
  await expect(chart).toHaveAttribute('aria-valuemax', '90')
  expect(backend.ranges.at(-1)).toBe(90)
})

test('visual traffic dashboard refreshes on events and preserves a stale snapshot on failure', async ({ page }) => {
  const realtime = await installBackend(page)
  const backend = await installTrafficData(page)
  await page.goto('/admin/analytics')
  const headline = page.locator('.traffic-hero__headline > strong')
  await expect(headline).toHaveText(String(backend.total))
  await expect(page.getByRole('button', { name: 'Reaalajaühendus aktiivne Uuenda andmeid' })).toBeVisible()
  await page.clock.runFor(350)
  const baseline = backend.ranges.length
  backend.setAdded(1)
  for (let i = 0; i < 5; i++) realtime.emit('admin_homepage_refresh')
  await page.clock.runFor(250)
  await expect(headline).toHaveText(String(backend.total + 1))
  expect(backend.ranges.length).toBe(baseline + 1)
  await expect(page.locator('.traffic-hero .visit-feedback__badge')).toHaveText('+1 uus külastus')
  backend.setMode('error')
  realtime.emit('admin_homepage_refresh')
  await page.clock.runFor(250)
  await expect(page.getByRole('button', { name: /Värskendamine ebaõnnestus/ })).toBeVisible()
  await expect(headline).toHaveText(String(backend.total + 1))
  backend.setMode('ready')
  backend.setAdded(2)
  realtime.disconnect()
  await page.clock.runFor(2500)
  await expect(headline).toHaveText(String(backend.total + 2))
  await expect(page.getByRole('button', { name: 'Reaalajaühendus aktiivne Uuenda andmeid' })).toBeVisible()
})

test('visual traffic dashboard distinguishes zero, unmeasured engagement, and failed requests', async ({ page }) => {
  const realtime = await installBackend(page)
  const backend = await installTrafficData(page)
  backend.setMode('error')
  await page.goto('/admin/analytics')
  await expect(page.getByRole('alert')).toContainText('Andmed pole saadaval')
  await expect(page.locator('.traffic-hero__headline > strong')).toHaveText('—')
  backend.setMode('unmeasured')
  await page.getByRole('button', { name: 'Proovi uuesti', exact: true }).click()
  await expect(page.locator('.traffic-hero__headline > strong')).toHaveText(String(backend.total))
  await expect(page.getByRole('button', { name: 'Vähemalt 10 sekundit aktiivsed: —' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Keskmine aktiivne aeg: teadmata' })).toBeVisible()
  await expect(page.locator('.traffic-ring__value')).toHaveCount(0)
  backend.setMode('zero')
  await page.clock.runFor(350)
  realtime.emit('admin_homepage_refresh')
  await page.clock.runFor(250)
  await expect(page.locator('.traffic-hero__headline > strong')).toHaveText('0')
  await expect(page.locator('.traffic-ring__segment')).toHaveCount(0)
  await expect(page.getByRole('slider', { name: 'Külastused päevade kaupa' })).toBeVisible()
  await expect(page.locator('.traffic-chart__line')).not.toHaveAttribute('d', /NaN|Infinity/)
})

test('visual traffic dashboard catches a realtime event that arrives during an unfinished request', async ({ page }) => {
  const realtime = await installBackend(page)
  const backend = await installOverviewData(page)
  await page.goto('/admin/analytics')
  const headline = page.locator('.traffic-hero__headline > strong')
  await expect(headline).toHaveText('465')
  await page.clock.runFor(350)
  const initialRequests = backend.requestedRanges.length
  const release = backend.holdResponse()
  backend.setAdded(1)
  realtime.emit('admin_homepage_refresh')
  await page.clock.runFor(250)
  await expect.poll(() => backend.requestedRanges.length).toBe(initialRequests + 1)
  backend.setAdded(2)
  realtime.emit('admin_homepage_refresh')
  await page.clock.runFor(250)
  expect(backend.requestedRanges.length).toBe(initialRequests + 1)
  release()
  await expect(headline).toHaveText('466')
  await page.clock.runFor(250)
  await expect(headline).toHaveText('467')
  expect(backend.requestedRanges.length).toBe(initialRequests + 2)
})

test('visual traffic dashboard fits desktop screens with a ninety-day chart and opens keyboard-safe details', async ({ page }) => {
  await installBackend(page)
  await installTrafficData(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/admin/analytics')
  await expect(page.locator('.traffic-ranking > button')).toHaveCount(4)
  await page.getByRole('group', { name: 'Ajavahemik' }).getByRole('button', { name: '90 päeva' }).click()
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuemax', '90')
  for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [1024, 768], [1280, 640]]) {
    await page.setViewportSize({ width, height })
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
      cards: [...document.querySelectorAll('.traffic-card')].map(el => ({ height: el.clientHeight, scroll: el.scrollHeight, bottom: el.getBoundingClientRect().bottom })),
    }))
    expect(dimensions.width).toBeLessThanOrEqual(width)
    expect(dimensions.height).toBeLessThanOrEqual(height)
    for (const card of dimensions.cards) { expect(card.scroll).toBeLessThanOrEqual(card.height + 1); expect(card.bottom).toBeLessThanOrEqual(height) }
    await page.getByRole('button', { name: 'Kuidas andmeid lugeda' }).click()
    await expect(page.getByRole('dialog')).toBeInViewport()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.querySelector('dialog')!.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await page.screenshot({ path: `output/traffic-desktop-${width}.png`, fullPage: true })
  }
})

test.describe('visual traffic on touchscreens', () => {
  test.use({ hasTouch: true })
  test('charts, metric switches and disclosures work without horizontal overflow', async ({ page }) => {
    await installBackend(page)
    const backend = await installTrafficData(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/admin/analytics')
    await expect(page.locator('.traffic-hero__headline > strong')).toHaveText(String(backend.total))
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await page.getByRole('slider').tap()
      await expect(page.locator('.traffic-chart__readout time')).toBeVisible()
      await page.getByRole('button', { name: 'Huvi üksikasjad' }).tap()
      await expect(page.getByRole('dialog')).toContainText('Mõõtmata aeg ei tähenda null sekundit')
      await page.getByRole('button', { name: 'Sulge üksikasjad' }).tap()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.screenshot({ path: `output/traffic-mobile-${width}.png`, fullPage: true })
    }
  })
})

test.describe('admin stories navigation', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
    const touch = await page.context().newCDPSession(page)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
    for (let step = 1; step <= 8; step++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8,
      }] })
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.clock.runFor(450)
    await touch.detach()
  }

  test('touch follows menu order and preserves user search across both directions', async ({ page }) => {
    await installBackend(page)
    await installTrafficData(page)
    await page.goto('/admin/analytics')
    await expect(page.locator('.traffic-hero__headline > strong')).toHaveText('778')
    const nav = page.getByRole('navigation', { name: 'Administraatori menüü' })
    await expect(nav.getByRole('link').nth(2)).toHaveText('Kasutajad')
    const trafficLink = await nav.getByRole('link', { name: 'Külastatavus', exact: true }).boundingBox()
    const usersLink = await nav.getByRole('link', { name: 'Kasutajad', exact: true }).boundingBox()
    expect(usersLink!.x).toBeGreaterThan(trafficLink!.x)
    const headline = await page.locator('.traffic-hero__headline').boundingBox()
    const y = headline!.y + headline!.height / 2
    await swipe(page, { x: 270, y }, { x: 60, y })
    await expect(page).toHaveURL(/\/admin\/users$/)
    await expect(page.locator('[data-story-view="analytics"]')).toHaveAttribute('inert', '')
    await page.getByRole('searchbox', { name: 'Otsi kasutajaid' }).fill('Angel')
    await expect(page.locator('.admin-user-row')).toHaveCount(1)
    const heading = await page.getByRole('heading', { name: 'Kasutajad', exact: true }).boundingBox()
    const headingY = heading!.y + heading!.height / 2
    await swipe(page, { x: 80, y: headingY }, { x: 300, y: headingY })
    await expect(page).toHaveURL(/\/admin\/analytics$/)
    await expect(page.locator('[data-story-view="users"]')).toHaveAttribute('inert', '')
    await swipe(page, { x: 270, y }, { x: 60, y })
    await expect(page.getByRole('searchbox', { name: 'Otsi kasutajaid' })).toHaveValue('Angel')
    await expect(page.locator('.admin-user-row')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await page.getByText('Filtrid', { exact: true }).click()
    await nav.getByRole('link', { name: 'Külastatavus', exact: true }).click()
    await page.clock.runFor(450)
    await expect(page).toHaveURL(/\/admin\/analytics$/)
    await swipe(page, { x: 270, y }, { x: 60, y })
    await expect(page).toHaveURL(/\/admin\/users$/)
  })

  test('short swipes cancel while charts and vertical scrolling retain their own gestures', async ({ page }) => {
    await installBackend(page)
    await installTrafficData(page)
    await page.goto('/admin/analytics')
    await expect(page.locator('.traffic-hero__headline > strong')).toHaveText('778')
    const headline = await page.locator('.traffic-hero__headline').boundingBox()
    const y = headline!.y + headline!.height / 2
    await swipe(page, { x: 250, y }, { x: 225, y })
    await expect(page).toHaveURL(/\/admin\/analytics$/)
    await expect(page.locator('.admin-story-deck')).not.toHaveAttribute('data-motion')
    const chart = await page.getByRole('slider').boundingBox()
    await swipe(page, { x: chart!.x + chart!.width - 20, y: chart!.y + 30 }, { x: chart!.x + 20, y: chart!.y + 30 })
    await expect(page).toHaveURL(/\/admin\/analytics$/)
    await expect(page.locator('.traffic-chart__readout time')).toBeVisible()
    await swipe(page, { x: 250, y }, { x: 250, y: y - 110 })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await expect(page).toHaveURL(/\/admin\/analytics$/)
  })

  test('all admin views swipe in menu order on mobile, including settings and both end stops', async ({ page }) => {
    await installBackend(page)
    await installOverviewData(page)
    await installTrafficData(page)
    await page.route('**/__e2e_supabase/functions/v1/lead-outreach', (route) => route.fulfill({ json: {
      settings: { enabled: false, daily_limit: 50, subject: '', body: '', updated_at: '' },
      counts: { queued: 0, sending: 0, failed: 0, replied: 0, blocked: 0, sent_today: 0, sent_total: 0 },
      last_import: null, last_send: null,
    } }))
    await page.goto('/admin')
    const paths = ['/admin', '/admin/analytics', '/admin/users', '/admin/campaigns', '/admin/seo', '/admin/business-card', '/admin/leads', '/admin/support', '/admin/kaubamaja', '/admin/settings']
    const move = async (forward: boolean) => {
      await page.evaluate(() => window.scrollTo(0, 0))
      const panel = page.locator('.admin-story-panel.is-current')
      await expect(panel).toBeVisible()
      const heading = panel.getByRole('heading').first()
      await expect(heading).toBeVisible()
      const bounds = await heading.boundingBox()
      const y = bounds!.y + bounds!.height / 2
      await swipe(page, { x: forward ? 150 : 80, y }, { x: forward ? 30 : 300, y })
    }
    await expect(page.locator('.admin-story-position')).toBeVisible()
    await move(false)
    await expect(page).toHaveURL(paths[0])
    for (const path of paths.slice(1)) {
      await move(true)
      await expect(page).toHaveURL(path)
      await expect(page.locator(`.admin-sidebar a[href="${path}"]`)).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('.admin-story-deck')).not.toHaveAttribute('data-motion')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    }
    await move(true)
    await expect(page).toHaveURL(paths.at(-1)!)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const path of paths.slice(0, -1).reverse()) {
      await move(false)
      await expect(page).toHaveURL(path)
      await expect(page.locator('.admin-story-deck')).not.toHaveAttribute('data-motion')
    }
  })

  test('form fields, editor canvases and open dialogs keep their touch gestures', async ({ page }) => {
    await installBackend(page)
    await installTrafficData(page)
    await page.goto('/admin/seo')
    const field = page.locator('#admin-seo-form input').first()
    await field.scrollIntoViewIfNeeded()
    const input = await field.boundingBox()
    await swipe(page, { x: 270, y: input!.y + input!.height / 2 }, { x: 80, y: input!.y + input!.height / 2 })
    await expect(page).toHaveURL(/\/admin\/seo$/)

    await page.goto('/admin/business-card')
    const canvas = page.getByRole('group', { name: 'Esikülje kujundus' })
    await expect(canvas).toBeVisible()
    await canvas.scrollIntoViewIfNeeded()
    const card = await canvas.boundingBox()
    await swipe(page, { x: 270, y: card!.y + card!.height / 2 }, { x: 80, y: card!.y + card!.height / 2 })
    await expect(page).toHaveURL(/\/admin\/business-card$/)
    await expect(page.locator('.admin-story-deck')).not.toHaveAttribute('data-motion')

    await page.goto('/admin/campaigns')
    const overlay = page.locator('.campaign-editor__overlay').first()
    await expect(overlay).toBeVisible()
    await overlay.scrollIntoViewIfNeeded()
    const campaign = await overlay.boundingBox()
    await swipe(page, { x: 270, y: campaign!.y + campaign!.height / 2 }, { x: 80, y: campaign!.y + campaign!.height / 2 })
    await expect(page).toHaveURL(/\/admin\/campaigns$/)

    await page.goto('/admin/analytics')
    await page.getByRole('button', { name: 'Kuidas andmeid lugeda' }).click()
    const dialog = page.getByRole('dialog')
    const bounds = await dialog.boundingBox()
    await swipe(page, { x: 270, y: bounds!.y + bounds!.height / 2 }, { x: 80, y: bounds!.y + bounds!.height / 2 })
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/analytics$/)
  })

  test('desktop ignores trackpad and touch swipes while menu links and browser history work', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await installBackend(page)
    await installTrafficData(page)
    await page.goto('/admin/analytics')
    await expect(page.locator('.traffic-hero__headline > strong')).toHaveText('778')
    const headline = await page.locator('.traffic-hero__headline').boundingBox()
    await page.mouse.move(headline!.x + headline!.width / 2, headline!.y + headline!.height / 2)
    await page.mouse.wheel(450, 0)
    await page.clock.runFor(500)
    await expect(page).toHaveURL(/\/admin\/analytics$/)
    await swipe(page, { x: headline!.x + 250, y: headline!.y + 10 }, { x: headline!.x + 50, y: headline!.y + 10 })
    await expect(page).toHaveURL(/\/admin\/analytics$/)
    await expect(page.locator('.admin-story-position')).toBeHidden()
    await expect(page.locator('.admin-story-deck')).not.toHaveAttribute('data-motion')
    await page.getByRole('navigation').getByRole('link', { name: 'Kasutajad', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/users$/)
    await expect(page.getByRole('heading', { name: 'Kasutajad', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(900)
    await page.goBack()
    await expect(page).toHaveURL(/\/admin\/analytics$/)
    await expect(page.getByRole('heading', { name: 'Külastatavus', exact: true })).toBeVisible()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('navigation').getByRole('link', { name: 'Kasutajad', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/users$/)
    await expect(page.locator('.admin-story-deck')).not.toHaveAttribute('data-motion')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
    await page.goBack()
    await expect(page).toHaveURL(/\/admin\/analytics$/)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.admin-story-position')).toBeVisible()
    const mobileHeadline = await page.locator('.traffic-hero__headline').boundingBox()
    await swipe(page, { x: 270, y: mobileHeadline!.y + 10 }, { x: 60, y: mobileHeadline!.y + 10 })
    await expect(page).toHaveURL(/\/admin\/users$/)
  })
})

test('store attraction shows actual clicks and CTR, supports selection, and switches periods', async ({ page }) => {
  await installBackend(page)
  await installOverviewData(page)
  const backend = await installAttractionData(page)
  await page.goto('/admin')
  const panel = page.getByRole('region', { name: 'Poodide tõmbejõud' })
  await expect(panel.locator('.attraction-headline strong')).toHaveText('36')
  await expect(panel.locator('.attraction-bubble')).toHaveCount(4)
  await expect(panel.locator('.attraction-detail')).toHaveCount(0)
  await panel.getByRole('button', { name: /^Keraamika Stuudio:/ }).hover()
  await expect(panel.locator('.attraction-detail')).toContainText('Keraamika Stuudio')
  await expect(panel.getByRole('group', { name: 'Klikimäär: 25%', exact: true })).toBeVisible()
  await expect(panel.locator('.attraction-bubble__arc').first()).toHaveAttribute('stroke-dasharray', '25 100')
  const puit = panel.getByRole('button', { name: /^Põhjala Puit:/ })
  await puit.click()
  await expect(panel.locator('.attraction-detail')).toContainText('Põhjala Puit')
  await expect(panel.locator('.attraction-detail')).toContainText('−50%')
  await puit.focus()
  await page.keyboard.press('ArrowRight')
  await expect(panel.getByRole('button', { name: /^Ehtepood:/ })).toBeFocused()
  await expect(panel.locator('.attraction-detail')).toContainText('Ehtepood')
  await page.keyboard.press('Escape')
  await expect(panel.locator('.attraction-detail')).toHaveCount(0)
  await panel.getByRole('button', { name: '30 päeva', exact: true }).click()
  await expect(panel.locator('.attraction-headline strong')).toHaveText('72')
  expect(backend.ranges).toContain(7)
  expect(backend.ranges.at(-1)).toBe(30)
  backend.setComparison(false)
  await page.clock.fastForward(60_000)
  await expect(panel.locator('.attraction-trend').first()).toHaveAttribute('aria-label', 'Võrdlus koguneb')
  await expect(panel.locator('.attraction-trend').first()).toHaveText('—')
  await expect(panel.locator('.attraction-bubble.is-unknown')).toHaveCount(4)
  backend.setMode('error')
  await page.clock.fastForward(60_000)
  await expect(panel.getByRole('button', { name: 'Kuvan viimati laaditud andmeid. Värskenda.' })).toBeVisible()
  await expect(panel.locator('.attraction-headline strong')).toHaveText('72')
})

test('store attraction distinguishes failure, zero clicks, and no stores', async ({ page }) => {
  await installBackend(page)
  await installOverviewData(page)
  const backend = await installAttractionData(page)
  backend.setMode('error')
  await page.goto('/admin')
  const panel = page.getByRole('region', { name: 'Poodide tõmbejõud' })
  await expect(panel.getByRole('status', { name: 'Kaubamaja andmeid ei saanud laadida' })).toBeVisible()
  await expect(panel.locator('.attraction-headline strong')).toHaveText('—')
  backend.setMode('zero')
  await panel.getByRole('button', { name: 'Proovi uuesti' }).click()
  await expect(panel.locator('.attraction-headline strong')).toHaveText('0')
  await expect(panel.locator('.attraction-bubble.is-zero')).toHaveCount(4)
  await expect(panel.locator('.attraction-bubble__arc')).toHaveCount(0)
  await panel.getByRole('button', { name: /^Linane:/ }).click()
  await expect(panel.getByRole('group', { name: 'Klikimäär: —', exact: true })).toBeVisible()
  backend.setMode('empty')
  await page.clock.fastForward(60_000)
  await expect(panel.getByRole('status', { name: 'Avalikke poode ega selle perioodi poeandmeid veel pole' })).toBeVisible()
  await expect(panel.locator('.attraction-bubble')).toHaveCount(0)
})

test('store attraction reacts to committed events, coalesces bursts, and catches events during a request', async ({ page }) => {
  const realtime = await installBackend(page)
  await installOverviewData(page)
  const backend = await installAttractionData(page)
  await page.goto('/admin')
  const panel = page.getByRole('region', { name: 'Poodide tõmbejõud' })
  await expect(panel.getByRole('button', { name: 'Reaalajaühendus aktiivne' })).toBeVisible()
  await page.clock.runFor(200)
  await expect(panel.locator('.attraction-headline strong')).toHaveText('36')
  const start = backend.ranges.length
  backend.setAdded(1)
  for (let i = 0; i < 5; i++) realtime.emit('admin_directory_refresh')
  await page.clock.runFor(200)
  await expect(panel.locator('.attraction-headline strong')).toHaveText('37')
  expect(backend.ranges.length).toBe(start + 1)
  await expect(panel.locator('.attraction-bubble.is-updated')).toHaveCount(1)
  await page.clock.runFor(1500)
  await expect(panel.locator('.attraction-bubble.is-updated')).toHaveCount(0)

  const release = backend.holdResponse()
  backend.setAdded(2)
  realtime.emit('admin_directory_refresh')
  await page.clock.runFor(200)
  await expect.poll(() => backend.ranges.length).toBe(start + 2)
  backend.setAdded(3)
  realtime.emit('admin_directory_refresh')
  await page.clock.runFor(200)
  release()
  await expect(panel.locator('.attraction-headline strong')).toHaveText('38')
  await page.clock.runFor(200)
  await expect(panel.locator('.attraction-headline strong')).toHaveText('39')
  expect(backend.ranges.length).toBe(start + 3)
  realtime.disconnect()
  await expect(panel.getByRole('button', { name: 'Reaalajaühendus taastub' })).toBeVisible()
  backend.setAdded(4)
  await page.clock.runFor(2500)
  await expect(panel.getByRole('button', { name: 'Reaalajaühendus aktiivne' })).toBeVisible()
  await expect(panel.locator('.attraction-headline strong')).toHaveText('40')
})

test('desktop overview fits the viewport including opened store details and help', async ({ page }) => {
  await installBackend(page)
  await installOverviewData(page)
  await installAttractionData(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/admin')
  const panel = page.getByRole('region', { name: 'Poodide tõmbejõud' })
  await expect(panel.locator('.attraction-bubble')).toHaveCount(4)
  for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 768], [1280, 720], [1024, 768], [1280, 640]]) {
    await page.setViewportSize({ width, height })
    await panel.getByRole('button', { name: /^Keraamika Stuudio:/ }).focus()
    await expect(panel.locator('.attraction-detail')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height)
    await page.keyboard.press('Escape')
    await panel.locator('.attraction-help summary').click()
    await expect(panel.locator('.attraction-help p').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height)
    await panel.locator('.attraction-help summary').click()
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
      main: { client: document.querySelector('.admin-main')!.clientHeight, scroll: document.querySelector('.admin-main')!.scrollHeight },
      panels: [...document.querySelectorAll('.overview-panel')].map((element) => ({ client: element.clientHeight, scroll: element.scrollHeight, bottom: element.getBoundingClientRect().bottom })),
    }))
    expect(dimensions.width).toBeLessThanOrEqual(width)
    expect(dimensions.height).toBeLessThanOrEqual(height)
    expect(dimensions.main.scroll).toBeLessThanOrEqual(dimensions.main.client)
    for (const card of dimensions.panels) {
      expect(card.scroll).toBeLessThanOrEqual(card.client + 1)
      expect(card.bottom).toBeLessThanOrEqual(height)
    }
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `output/admin-overview-compact-${width}.png`, fullPage: true })
  }
})

test.describe('store attraction touch controls', () => {
  test.use({ hasTouch: true })
  test('store attraction remains readable and selectable on narrow touchscreens', async ({ page }) => {
    await installBackend(page)
    await installOverviewData(page)
    await installAttractionData(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/admin')
    const panel = page.getByRole('region', { name: 'Poodide tõmbejõud' })
    await expect(panel.locator('.attraction-bubble')).toHaveCount(4)
    await panel.screenshot({ path: 'output/admin-attraction-desktop.png' })
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await panel.getByRole('button', { name: /^Linane:/ }).tap()
      await expect(panel.locator('.attraction-detail')).toContainText('Linane')
      await expect(panel.getByRole('group', { name: 'Klikimäär: —', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await panel.screenshot({ path: `output/admin-attraction-mobile-${width}.png` })
      await panel.getByRole('button', { name: 'Sulge poe näitajad' }).tap()
    }
  })
})

test('homepage visits highlight increases, clear the badge, and ignore unchanged totals and period changes', async ({ page }) => {
  await installBackend(page)
  const backend = await installOverviewData(page)
  await page.goto('/admin')
  const headline = page.locator('.overview-traffic__headline > strong')
  const badge = page.locator('.visit-feedback__badge')
  const panel = page.getByRole('region', { name: 'Avalehe külastatavus' })
  await expect(headline).toHaveText('465')
  await expect(badge).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Külastuste ja uute kontode heli' })).toHaveCount(0)
  backend.setAdded(1)
  await page.clock.fastForward(15_000)
  await expect(headline).toHaveText('466')
  await expect(badge).toHaveText('+1 uus külastus')
  await expect(panel).toHaveClass(/has-new-visits/)
  await expect(headline.locator('.visit-feedback__number')).toHaveClass(/is-new/)
  await page.clock.fastForward(3300)
  await expect(badge).toHaveCount(0)
  await expect(panel).not.toHaveClass(/has-new-visits/)
  const requestsBeforeUnchanged = backend.requestedRanges.length
  await page.clock.fastForward(15_000)
  await expect.poll(() => backend.requestedRanges.length).toBeGreaterThan(requestsBeforeUnchanged)
  await expect(badge).toHaveCount(0)
  backend.setAdded(5)
  await page.clock.fastForward(15_000)
  await expect(badge).toHaveText('+4 uut külastust')
  await page.getByRole('group', { name: 'Külastatavuse periood', exact: true }).getByRole('button', { name: '90 p', exact: true }).click()
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

test('new accounts and simultaneous visits retain distinct visual badges', async ({ page }, testInfo) => {
  await installBackend(page)
  const backend = await installOverviewData(page)
  await page.goto('/admin')
  const headline = page.locator('.overview-traffic__headline > strong')
  const accounts = page.getByRole('button', { name: /Uued kontod/ })
  const accountBadge = page.locator('.visit-feedback__badge[data-kind="account"]')
  const settings = page.getByRole('link', { name: 'Seaded', exact: true })
  await expect(headline).toHaveText('465')
  await expect(accounts.locator('strong')).toHaveText('15')
  await expect(accountBadge).toHaveCount(0)
  backend.setAddedAccounts(1)
  await page.clock.fastForward(15_000)
  await expect(accounts.locator('strong')).toHaveText('16')
  await expect(accounts).toHaveClass(/has-new-accounts/)
  await expect(accountBadge).toHaveText('+1 uus konto')
  await expect(headline).toHaveText('465')
  await page.locator('.overview-traffic').screenshot({ path: testInfo.outputPath('new-account-desktop.png') })
  await expect(settings).toHaveCount(1)
  backend.setAddedAccounts(3)
  await page.clock.fastForward(15_000)
  await expect(accountBadge).toHaveText('+2 uut kontot')
  await page.clock.fastForward(3300)
  await expect(accountBadge).toHaveCount(0)
  await page.clock.fastForward(15_000)
  await page.getByRole('group', { name: 'Külastatavuse periood', exact: true }).getByRole('button', { name: '90 p', exact: true }).click()
  await expect(accounts.locator('strong')).toHaveText('48')
  await expect(accountBadge).toHaveCount(0)

  backend.setAdded(2)
  backend.setAddedAccounts(4)
  await page.clock.fastForward(15_000)
  await expect(accountBadge).toHaveText('+1 uus konto')
  await expect(page.locator('.visit-feedback__badge[data-kind="visit"]')).toHaveText('+2 uut külastust')
  await accounts.click()
  await expect(headline).toHaveText('49')
  await expect(page.locator('.overview-traffic__headline .visit-feedback__badge')).toHaveText('+1 uus konto')

  await page.getByRole('link', { name: 'Ava külastatavuse üksikasjad' }).click()
  await expect(settings).toHaveCount(1)
  // A rolling-window decrease in visits must not swallow a new account.
  backend.setAdded(0)
  backend.setAddedAccounts(5)
  await page.clock.fastForward(15_000)
  await expect(page.locator('.traffic-stages .visit-feedback__badge')).toHaveText('+1 uus konto')
  backend.setAddedAccounts(0)
  await page.clock.fastForward(15_000)
  await expect(accountBadge).toHaveCount(0)
  backend.setAddedAccounts(1)
  await page.clock.fastForward(15_000)
  await expect(accountBadge).toHaveText('+1 uus konto')
})

test('homepage visit feedback and settings navigation remain usable on mobile with reduced motion', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installBackend(page)
  const backend = await installOverviewData(page)
  await page.goto('/admin')
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('465')
  const settings = page.getByRole('link', { name: 'Seaded', exact: true })
  await expect(settings).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Külastuste ja uute kontode heli' })).toHaveCount(0)
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
  await expect(settings).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('homepage analytics refreshes silently without overlapping requests and recovers from failures', async ({ page }) => {
  await installBackend(page)
  const backend = await installOverviewData(page)
  await page.goto('/admin')
  const chart = page.getByRole('slider', { name: 'Külastused päevade kaupa' })
  const headline = page.locator('.overview-traffic__headline > strong')
  await expect(headline).toHaveText('465')
  await page.clock.runFor(350)
  const initialRequests = backend.requestedRanges.length
  await chart.focus()
  await page.keyboard.press('End')
  backend.setAdded(5)
  backend.setAddedAccounts(5)
  const release = backend.holdResponse()
  await page.clock.fastForward(15_000)
  await expect.poll(() => backend.requestedRanges.length).toBe(initialRequests + 1)
  await expect(headline).toHaveText('465')
  await expect(chart).toBeFocused()
  await expect(page.getByRole('region', { name: 'Avalehe külastatavus' })).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('group', { name: 'Külastatavuse periood', exact: true }).getByRole('button', { name: '7 p', exact: true })).toBeEnabled()
  await page.clock.fastForward(15_000)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(backend.requestedRanges.length).toBe(initialRequests + 1)
  release()
  await expect(headline).toHaveText('470')
  await expect(chart).toBeFocused()
  await expect(chart).toHaveAttribute('aria-valuetext', '1. okt: 35 külastused')
  await expect(page.getByRole('button', { name: 'Alustamised' })).toContainText('35')
  await expect(page.getByRole('button', { name: 'Uued kontod' })).toContainText('20')

  backend.setMode('error')
  await page.clock.fastForward(15_000)
  await expect.poll(() => backend.requestedRanges.length).toBe(initialRequests + 2)
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
  await page.clock.runFor(350)
  const initialRequests = backend.requestedRanges.length
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(45_000)
  expect(backend.requestedRanges.length).toBe(initialRequests)
  backend.setAdded(1)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('466')
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }))
  await page.clock.fastForward(30_000)
  expect(backend.requestedRanges.length).toBe(initialRequests + 1)
  backend.setAdded(2)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
  })
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('467')
  await page.getByRole('link', { name: 'Kasutajad', exact: true }).click()
  await expect(page.locator('.admin-user-row')).toHaveCount(9)
  await page.clock.fastForward(30_000)
  expect(backend.requestedRanges.length).toBe(initialRequests + 2)
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
  await page.clock.runFor(350)
  const initialRequests = backend.requestedRanges.length
  const release = backend.holdResponse()
  await page.clock.fastForward(15_000)
  await expect.poll(() => backend.requestedRanges.length).toBe(initialRequests + 1)
  await page.getByRole('group', { name: 'Külastatavuse periood', exact: true }).getByRole('button', { name: '7 p', exact: true }).click()
  await expect.poll(() => backend.requestedRanges.at(-1)).toBe(7)
  release()
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('28')
  backend.setAdded(1)
  await page.clock.fastForward(15_000)
  await expect(page.locator('.overview-traffic__headline > strong')).toHaveText('29')
  expect(backend.requestedRanges.slice(backend.requestedRanges.indexOf(7)).every((days) => days === 7)).toBe(true)
  await page.getByRole('link', { name: 'Ava külastatavuse üksikasjad' }).click()
  backend.setAdded(2)
  await page.clock.fastForward(15_000)
  await expect(page.locator('.traffic-hero__headline > strong')).toHaveText('30')
  backend.setAdded(3)
  await page.getByRole('button', { name: /Uuenda andmeid/ }).click()
  await expect(page.locator('.traffic-hero__headline > strong')).toHaveText('31')
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
  await page.getByRole('group', { name: 'Külastatavuse periood', exact: true }).getByRole('button', { name: '7 p', exact: true }).click()
  await expect(starts).toHaveAttribute('aria-valuemax', '7')
  expect([...new Set(backend.requestedRanges)]).toEqual([30, 7])
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
  await expect(page.getByRole('group', { name: 'Ajavahemik' }).getByRole('button', { name: '7 päeva' })).toHaveAttribute('aria-pressed', 'true')
})

async function installRevenueFeedback(page: Page, mockAudio = true) {
  const realtime = await installBackend(page)
  await installOverviewData(page)
  if (mockAudio) await page.addInitScript(() => {
    const notes: { frequency: number; at: number }[] = []
    Object.assign(window, { revenueTestNotes: notes })
    class TestAudioContext {
      state = 'suspended'
      destination = {}
      get currentTime() { return performance.now() / 1000 }
      async resume() { this.state = 'running' }
      async suspend() { this.state = 'suspended' }
      async close() { this.state = 'closed' }
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} } }
      createOscillator() {
        const oscillator = { frequency: { value: 0 }, type: 'sine', connect() {}, disconnect() {}, stop() {},
          start(at: number) { notes.push({ frequency: oscillator.frequency.value, at }) }, onended: null }
        return oscillator
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: TestAudioContext, configurable: true })
  })
  await page.goto('/admin')
  const card = page.getByRole('region', { name: 'Poeruumi teenustasud' })
  await expect(card.locator('.overview-income__amount')).toHaveText('375,40 €')
  await expect.poll(() => realtime.subscriptions.has('revenue_events')).toBe(true)
  await page.clock.runFor(300)
  const pending: Route[] = []
  await page.route('**/rpc/admin_revenue_dashboard', route => { pending.push(route) })
  const event = (id: string, cents = 160, kind = 'transaction_fee') => ({ id, kind, amount_cents: cents,
    currency: 'eur', occurred_at: ago(0), store_id: 'store-3', store_name: 'Moreamoreceramics', description: 'Müügitasu' })
  const snapshot = (total: number, events: ReturnType<typeof event>[]) => ({ month_total_cents: total, today_total_cents: total - 35420,
    subscription_total_cents: 29900, transaction_fee_total_cents: total - 28900, refund_total_cents: -1000, recent_events: events })
  const emit = (id: string, cents = 160, kind = 'transaction_fee') => realtime.emit('revenue_events', event(id, cents, kind), 'INSERT')
  const noteCount = () => page.evaluate(() => (window as unknown as { revenueTestNotes: unknown[] }).revenueTestNotes.length)
  return { card, pending, event, snapshot, emit, noteCount, realtime }
}

test('revenue celebrates confirmed amounts with synchronized sound and ignores duplicates', async ({ page }) => {
  const { card, pending, event, snapshot, emit, noteCount } = await installRevenueFeedback(page)
  const sound = card.getByRole('button', { name: 'Laekumiste heli' })
  await expect(sound).toHaveAttribute('aria-pressed', 'false')
  await expect(card.locator('.revenue-delta')).toHaveCount(0)
  expect(await noteCount()).toBe(0)
  await sound.click()
  emit('fee-a')
  await page.clock.runFor(200)
  await expect.poll(() => pending.length).toBe(1)
  await expect(card).not.toHaveClass(/is-live-update/)
  await expect(card.locator('.overview-income__amount')).toHaveText('375,40 €')
  expect(await noteCount()).toBe(0)

  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100))
  await pending[0].fulfill({ json: snapshot(37700, [event('fee-a')]) })
  await expect(card.locator('.revenue-delta')).toContainText('+1,60 €')
  await expect.poll(noteCount).toBe(4)
  const notes = await page.evaluate(() => (window as unknown as { revenueTestNotes: { frequency: number; at: number }[] }).revenueTestNotes)
  expect(notes[0].frequency).toBe(659.25)
  expect(notes[2].frequency).toBe(987.77)
  expect(notes[2].at - notes[0].at).toBeCloseTo(.13)
  await page.clock.runFor(160)
  const intermediate = Number((await card.locator('.overview-income__amount').innerText()).replace(/[^\d,]/g, '').replace(',', '.'))
  expect(intermediate).toBeGreaterThan(375.4)
  expect(intermediate).toBeLessThan(377)
  await page.clock.runFor(1100)
  await expect(card.locator('.overview-income__amount')).toHaveText('377 €')
  await page.screenshot({ path: 'output/admin-revenue-celebration.png', fullPage: true })
  emit('fee-a')
  await page.clock.runFor(3400)
  expect(pending).toHaveLength(1)
  expect(await noteCount()).toBe(4)
  await expect(card.locator('.revenue-delta')).toHaveCount(0)

  await sound.click()
  emit('fee-b')
  await page.clock.runFor(200)
  await expect.poll(() => pending.length).toBe(2)
  await pending[1].fulfill({ json: snapshot(37860, [event('fee-b'), event('fee-a')]) })
  await expect(card.locator('.revenue-delta')).toContainText('+1,60 €')
  expect(await noteCount()).toBe(4)
  expect(await page.evaluate(() => localStorage.getItem('poeruum:revenue-sound'))).toBe('off')
})

test('revenue groups bursts and catches an event arriving during an unfinished refresh', async ({ page }) => {
  const { card, pending, event, snapshot, emit } = await installRevenueFeedback(page)
  for (const id of ['fee-a', 'fee-b', 'fee-c']) emit(id)
  await page.clock.runFor(250)
  await expect.poll(() => pending.length).toBe(1)
  emit('fee-d')
  await page.clock.runFor(250)
  expect(pending).toHaveLength(1)
  await pending[0].fulfill({ json: snapshot(38020, ['fee-a', 'fee-b', 'fee-c'].map(id => event(id))) })
  await expect(card.locator('.revenue-delta')).toContainText('+4,80 €')
  await expect.poll(() => pending.length).toBe(2)
  await pending[1].fulfill({ json: snapshot(38180, ['fee-d', 'fee-a', 'fee-b', 'fee-c'].map(id => event(id))) })
  await expect(card.locator('.revenue-delta')).toContainText('+1,60 €')
  await page.clock.runFor(1200)
  await expect(card.locator('.overview-income__amount')).toHaveText('381,80 €')
})

test('revenue suppresses celebrations for refunds, test payments, hidden tabs and reconnects', async ({ page }) => {
  const { card, pending, event, snapshot, emit, noteCount, realtime } = await installRevenueFeedback(page)
  await card.getByRole('button', { name: 'Laekumiste heli' }).click()
  emit('refund', -160, 'transaction_fee_refund')
  await page.clock.runFor(200)
  await expect.poll(() => pending.length).toBe(1)
  await pending[0].fulfill({ json: snapshot(37380, [event('refund', -160, 'transaction_fee_refund')]) })
  await expect(card.locator('.overview-income__amount')).toHaveText('373,80 €')
  await expect(card).not.toHaveClass(/is-live-update/)

  emit('test-payment')
  await page.clock.runFor(200)
  await expect.poll(() => pending.length).toBe(2)
  await pending[1].fulfill({ json: snapshot(37380, []) })
  await page.clock.runFor(200)
  await expect(card.locator('.revenue-delta')).toHaveCount(0)

  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
  emit('hidden')
  await page.clock.runFor(200)
  await expect.poll(() => pending.length).toBe(3)
  await pending[2].fulfill({ json: snapshot(37540, [event('hidden')]) })
  await expect(card.locator('.overview-income__amount')).toHaveText('375,40 €')
  await expect(card.locator('.revenue-delta')).toHaveCount(0)
  expect(await noteCount()).toBe(0)
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(() => pending.length).toBe(4)
  await pending[3].fulfill({ json: snapshot(37540, [event('hidden')]) })
  await page.clock.runFor(200)
  realtime.disconnect()
  await page.clock.runFor(2500)
  await expect.poll(() => pending.length).toBe(5)
  await pending[4].fulfill({ json: snapshot(37700, [event('missed')]) })
  await expect(card.locator('.overview-income__amount')).toHaveText('377 €')
  await expect(card.locator('.revenue-delta')).toHaveCount(0)
  expect(await noteCount()).toBe(0)
})

test('revenue respects reduced motion and stays within compact and mobile cards', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { card, pending, event, snapshot, emit } = await installRevenueFeedback(page)
  emit('fee-a')
  await page.clock.runFor(200)
  await expect.poll(() => pending.length).toBe(1)
  await pending[0].fulfill({ json: snapshot(37700, [event('fee-a')]) })
  await expect(card.locator('.overview-income__amount')).toHaveText('377 €')
  await expect(card.locator('.revenue-delta')).toContainText('+1,60 €')
  await expect(card.locator('.revenue-number')).toHaveCSS('animation-name', 'none')
  await expect(card.locator('.revenue-celebration')).not.toBeVisible()
  for (const [width, height] of [[1280, 640], [1024, 768], [390, 844], [320, 844]]) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const bounds = await card.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth, height: el.clientHeight, content: el.scrollHeight }))
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1)
    expect(bounds.content).toBeLessThanOrEqual(bounds.height + 1)
    await card.screenshot({ path: `output/admin-revenue-${width}.png` })
  }
})

test('revenue restores the sound preference and unlocks real audio after interaction', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('poeruum:revenue-sound', 'on'))
  const { card, pending, event, snapshot, emit } = await installRevenueFeedback(page, false)
  await page.evaluate(() => {
    const original = AudioContext.prototype.createOscillator
    Object.assign(window, { revenueTestNotes: [] })
    AudioContext.prototype.createOscillator = function () {
      const oscillator = original.call(this)
      ;(window as unknown as { revenueTestNotes: string[] }).revenueTestNotes.push(this.state)
      return oscillator
    }
  })
  await expect(card.getByRole('button', { name: 'Laekumiste heli' })).toHaveAttribute('aria-pressed', 'true')
  await card.getByRole('heading', { name: 'Teenustasud' }).click()
  emit('fee-real')
  await page.clock.runFor(200)
  await expect.poll(() => pending.length).toBe(1)
  await pending[0].fulfill({ json: snapshot(37700, [event('fee-real')]) })
  await expect.poll(() => page.evaluate(() => (window as unknown as { revenueTestNotes: string[] }).revenueTestNotes)).toEqual(['running', 'running', 'running', 'running'])
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

for (const width of [390, 1440]) {
  test(`support deletion confirms the target, preserves failed requests and removes only that conversation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    const spamId = '10000000-0000-4000-8000-000000000081'
    const keepId = '10000000-0000-4000-8000-000000000082'
    let rows = [
      { id: spamId, user_id: null, email: 'sender@example.invalid', contact_name: 'Väline saatja', origin: 'email', store_name: null,
        subject: 'Kahtlane autoriõiguse teavitus', status: 'open', category: 'question', last_message_at: ago(1), created_at: ago(2), last_message_preview: 'Kahtlane kiri', is_unread: true },
      { id: keepId, user_id: users[4].user_id, email: users[4].email, contact_name: null, origin: 'app', store_name: users[4].store_name,
        subject: 'Päris kliendi küsimus', status: 'open', category: 'question', last_message_at: ago(3), created_at: ago(4), last_message_preview: 'Palun abi.', is_unread: false },
    ]
    const actions: Record<string, unknown>[] = []
    let fail = true
    let finishDelete: (() => Promise<void>) | undefined
    await page.route('**/rpc/admin_support_conversations', (route) => route.fulfill({ json: rows }))
    await page.route('**/rpc/mark_support_conversation_read', (route) => route.fulfill({ json: null }))
    await page.route('**/support_messages?*', (route) => route.fulfill({ json: [{
      id: 'message-test', sender_kind: 'user', body: new URL(route.request().url()).searchParams.get('conversation_id') === `eq.${spamId}` ? 'Kahtlane kiri' : 'Palun abi.',
      source: 'email', is_internal: false, created_at: ago(1),
    }] }))
    await page.route('**/functions/v1/support-actions', (route) => {
      const body = route.request().postDataJSON()
      actions.push(body)
      if (fail) return route.fulfill({ status: 500, json: { error: 'Kustutamine ebaõnnestus.' } })
      finishDelete = async () => {
        rows = rows.filter((row) => row.id !== body.conversation_id)
        await route.fulfill({ json: { ok: true } })
      }
    })
    await page.goto(`/admin/support?conversation=${spamId}`)
    await expect(page.getByRole('heading', { name: 'Kahtlane autoriõiguse teavitus' })).toBeVisible()
    const draft = page.getByPlaceholder('Kirjuta saatjale vastus…')
    await draft.fill('Salvestamata mustand')
    const trigger = page.getByRole('button', { name: 'Kustuta vestlus', exact: true })
    await trigger.click()
    const confirmation = page.getByRole('alertdialog', { name: 'Kustuta vestlus?' })
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toContainText('Kahtlane autoriõiguse teavitus')
    await expect(confirmation.getByRole('button', { name: 'Loobu' })).toBeFocused()
    await expect.poll(() => confirmation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: `output/support-delete-${width}.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(confirmation).not.toBeVisible()
    await expect(trigger).toBeFocused()
    expect(actions).toEqual([])
    await trigger.click()
    await confirmation.getByRole('button', { name: 'Kustuta', exact: true }).click()
    await expect(confirmation.getByRole('alert')).toBeVisible()
    await expect(page.locator('.admin-support__list > button')).toHaveCount(2)
    await confirmation.getByRole('button', { name: 'Loobu' }).click()
    await expect(draft).toHaveValue('Salvestamata mustand')
    fail = false
    await trigger.click()
    await confirmation.getByRole('button', { name: 'Kustuta', exact: true }).click()
    await expect(confirmation.getByRole('button', { name: 'Kustutan…' })).toBeDisabled()
    await expect(confirmation.getByRole('button', { name: 'Loobu' })).toBeDisabled()
    await expect.poll(() => Boolean(finishDelete)).toBe(true)
    await finishDelete!()
    await expect(confirmation).not.toBeVisible()
    await expect(page.locator('.admin-support__list > button')).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Kahtlane autoriõiguse teavitus' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Aktiivsed 1', exact: true })).toBeFocused()
    await page.locator('.admin-support__list > button').click()
    await expect(page.getByRole('heading', { name: 'Päris kliendi küsimus' })).toBeVisible()
    await expect(page.locator('.admin-support__messages')).toHaveText(/Palun abi\./)
    await expect(draft).toBeEmpty()
    expect(actions).toEqual([{ action: 'delete', conversation_id: spamId }, { action: 'delete', conversation_id: spamId }])
  })
}

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
  expect(await first.evaluate((element) => element.getAnimations().length)).toBe(0)
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

test('user controls scroll away while desktop navigation stays in place', async ({ page }) => {
  await installBackend(page)
  await page.goto('/admin/users')
  const list = page.getByRole('region', { name: 'Kasutajate nimekiri', exact: true })
  const workspace = page.locator('.admin-users')
  await expect(page.locator('.admin-user-row')).toHaveCount(9)
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [390, 640], [844, 390]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => window.scrollTo(0, 0))
    await list.evaluate((element) => { element.scrollTop = 0 })
    await workspace.evaluate((element) => { element.scrollTop = 0 })
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
    const fixed = page.locator('.admin-sidebar')
    const before = await fixed.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top))
    const box = (await workspace.boundingBox())!
    expect(box.height).toBeGreaterThan(140)
    expect(box.y + box.height).toBeLessThanOrEqual(height)
    await page.getByRole('button', { name: 'URGITS: üksikasjad' }).click()
    await workspace.evaluate((element) => { element.scrollTop = 0 })
    await page.locator('.admin-user-row').first().hover()
    await page.mouse.wheel(0, 700)
    await expect.poll(() => workspace.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    expect(await list.evaluate((element) => element.scrollTop)).toBe(0)
    await expect(page.locator('.admin-users > header')).not.toBeInViewport()
    await expect(page.locator('.admin-users__metrics')).not.toBeInViewport()
    await expect(page.locator('.admin-users__toolbar')).not.toBeInViewport()
    expect(await fixed.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top))).toEqual(before)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await page.screenshot({ path: `output/admin-users-scroll-${width}.png`, animations: 'disabled' })
    await page.mouse.wheel(0, -1000)
    await expect(page.getByRole('searchbox')).toBeInViewport()
    await expect(page.locator('.admin-users__metrics')).toBeInViewport()
    await list.focus()
    await workspace.evaluate((element) => { element.scrollTop = 0 })
    // Chromium animates PageDown on Linux. Let that keyboard scroll finish
    // before independently checking jumps to the bottom and back to a row.
    const keyboardScrollFinished = workspace.evaluate((element) => new Promise<number>((resolve) => {
      const finish = () => {
        if (element.scrollTop <= 0) return
        element.removeEventListener('scrollend', finish)
        resolve(element.scrollTop)
      }
      element.addEventListener('scrollend', finish)
    }))
    await page.keyboard.press('PageDown')
    expect(await keyboardScrollFinished).toBeGreaterThan(0)
    await workspace.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect(page.locator('.admin-user-row').last(), `Last row at ${width} × ${height}`).toBeInViewport()
    await page.getByRole('button', { name: 'URGITS', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'URGITS', exact: true })).toBeInViewport()
    await page.getByRole('searchbox').fill('ceramics')
    await expect(page.locator('.admin-user-row')).toHaveCount(1)
    await expect.poll(() => workspace.evaluate((element) => element.scrollTop)).toBe(0)
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
})

test('the sidebar can be hidden and restored without losing work, and remembers the preference', async ({ page }) => {
  await installBackend(page)
  await page.goto('/admin/users')
  const menu = page.getByRole('navigation', { name: 'Administraatori menüü' })
  const main = page.locator('.admin-main')
  const search = page.getByRole('searchbox')
  await search.fill('URGITS')
  await page.getByRole('button', { name: 'URGITS: üksikasjad' }).click()
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const before = (await main.boundingBox())!
    const hide = page.getByRole('button', { name: 'Peida menüü', exact: true })
    if (width === 1440) await page.screenshot({ path: 'output/admin-menu-visible.png', animations: 'disabled' })
    await hide.focus()
    await page.keyboard.press('Enter')
    const show = page.getByRole('button', { name: 'Näita menüüd', exact: true })
    await expect(show).toBeFocused()
    await expect(show).toHaveAttribute('aria-expanded', 'false')
    await expect(menu).toBeHidden()
    await expect(page.locator('#admin-sidebar')).toHaveAttribute('inert', '')
    if (width > 680) expect((await main.boundingBox())!.width).toBeGreaterThan(before.width)
    await expect(search).toHaveValue('URGITS')
    await expect(page.getByRole('button', { name: 'URGITS: üksikasjad' })).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('heading', { name: 'Kasutajad', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const button = (await show.boundingBox())!
    const heading = (await page.getByRole('heading', { name: 'Kasutajad', exact: true }).boundingBox())!
    expect(button.x + button.width <= heading.x || button.y + button.height <= heading.y).toBe(true)
    if (width === 1440 || width === 390) await page.screenshot({ path: `output/admin-menu-hidden-${width}.png`, animations: 'disabled' })
    await page.keyboard.press('Enter')
    await expect(hide).toBeFocused()
    await expect(menu).toBeVisible()
  }
  await page.getByRole('button', { name: 'Peida menüü', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Näita menüüd', exact: true })).toBeVisible()
  await expect(menu).toBeHidden()
  await page.getByRole('button', { name: 'Näita menüüd', exact: true }).click()
  await page.reload()
  await expect(menu).toBeVisible()
})

test('watch mode hides the menu restore button and returns to the chosen menu state', async ({ page }) => {
  await installBackend(page)
  await page.goto('/admin/users')
  await page.getByRole('button', { name: 'Vaatlusrežiim', exact: true }).click()
  await page.getByRole('button', { name: 'Peida menüü', exact: true }).click()
  const show = page.getByRole('button', { name: 'Näita menüüd', exact: true })
  await expect(show).toBeFocused()
  await page.clock.runFor(3100)
  await expect(page.getByRole('dialog', { name: 'Vaatlusrežiim' })).toBeVisible()
  await expect(show).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Vaatlusrežiim' })).toHaveCount(0)
  await expect(show).toBeFocused()
  await expect(page.locator('#admin-sidebar')).toBeHidden()
  await show.click()
  await expect(page.getByRole('button', { name: 'Vaatlusrežiim', exact: true })).toHaveAttribute('aria-pressed', 'false')
})

async function openWatch(page: Page, path = '/admin/analytics', visual = false) {
  const backend = await installBackend(page)
  const data = await installOverviewData(page)
  if (visual) await installTrafficData(page)
  await page.goto(path)
  await expect(page.getByRole('button', { name: 'Vaatlusrežiim', exact: true })).toBeVisible()
  await page.clock.runFor(500)
  await page.getByRole('button', { name: 'Vaatlusrežiim', exact: true }).click()
  await page.clock.runFor(3100)
  const screen = page.getByRole('dialog', { name: 'Vaatlusrežiim' })
  await expect(screen).toBeVisible()
  return { backend, data, screen }
}

test('watch is opt in, starts after three seconds, rotates and returns without changing the working view', async ({ page }) => {
  await installBackend(page)
  await installOverviewData(page)
  await page.goto('/admin/users')
  await expect(page.locator('.admin-user-row')).toHaveCount(users.length)
  await page.clock.runFor(5000)
  await expect(page.getByRole('dialog', { name: 'Vaatlusrežiim' })).toHaveCount(0)
  await page.getByRole('searchbox').fill('ceramics')
  await page.getByRole('button', { name: 'Vaatlusrežiim', exact: true }).click()
  await page.clock.runFor(2700)
  await expect(page.getByRole('dialog', { name: 'Vaatlusrežiim' })).toHaveCount(0)
  await page.clock.runFor(400)
  const screen = page.getByRole('dialog', { name: 'Vaatlusrežiim' })
  await expect(screen).toBeVisible()
  await expect(page.locator('.admin-sidebar')).toHaveAttribute('inert', '')
  await expect(screen).toHaveAttribute('data-scene', 'users')
  await expect(screen.locator('.watch-person')).toHaveCount(users.length)
  await page.clock.runFor(16_200)
  await expect(screen).toHaveAttribute('data-scene', 'income')
  await expect(page).toHaveURL('/admin/users')
  await page.mouse.move(500, 500)
  await expect(screen).toHaveCount(0)
  await expect(page.getByRole('searchbox')).toHaveValue('ceramics')
  await expect(page.locator('.admin-user-row')).toHaveCount(1)
  await page.clock.runFor(3100)
  await expect(screen).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(screen).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Vaatlusrežiim', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.clock.runFor(4000)
  await expect(screen).toHaveCount(0)
})

test('watch waits for text editing and preserves a dirty form during background updates', async ({ page }) => {
  const backend = await installBackend(page)
  await installOverviewData(page)
  await page.goto('/admin/seo')
  const input = page.locator('#admin-seo-form input[type="text"]').first()
  const fallback = page.locator('#admin-seo-form input').first()
  const field = await input.count() ? input : fallback
  await expect(field).toBeVisible()
  await page.getByRole('button', { name: 'Vaatlusrežiim', exact: true }).click()
  await field.fill('Poeruumi pooleliolev pealkiri')
  await page.clock.runFor(6000)
  await expect(page.getByRole('dialog', { name: 'Vaatlusrežiim' })).toHaveCount(0)
  backend.emit('admin_dashboard_refresh')
  await page.clock.runFor(700)
  await expect(field).toHaveValue('Poeruumi pooleliolev pealkiri')
  await page.locator('.admin-seo__summary h2').click()
  await page.clock.runFor(3100)
  await expect(page.getByRole('dialog', { name: 'Vaatlusrežiim' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(field).toHaveValue('Poeruumi pooleliolev pealkiri')
  await expect(page).toHaveURL('/admin/seo')
})

test('watch uses real snapshots for visits, new accounts and published stores', async ({ page }) => {
  const { backend, data, screen } = await openWatch(page)
  await expect(screen).not.toHaveAttribute('data-event')
  data.setAdded(4)
  backend.emit('admin_homepage_refresh')
  await page.clock.runFor(700)
  await expect(screen).toHaveAttribute('data-event', 'visit')
  await expect(screen.locator('.watch-big-number')).toHaveText('+4')
  const created = new Date(await page.evaluate(() => Date.now())).toISOString()
  // A request can return an older snapshot after the account was created.
  backend.emit('admin_dashboard_refresh')
  await page.clock.runFor(700)
  const newcomer = { ...users[2], user_id: 'new-watch-user', email: 'uus@example.invalid', user_created_at: created }
  const nextRows = [newcomer, ...users]
  backend.setRows(nextRows)
  backend.emit('admin_dashboard_refresh')
  await page.clock.runFor(2400)
  await expect(screen).toHaveAttribute('data-event', 'account')
  await expect(screen).toHaveAttribute('data-scene', 'users')
  await expect(screen.locator('[data-user-id="new-watch-user"]')).toHaveClass(/is-watch-spotlight/)
  await expect(screen.locator('.watch-person-name')).toContainText('uus@example.invalid')
  await screen.screenshot({ path: 'output/admin-watch-new-user.png', animations: 'disabled' })
  await page.clock.runFor(9200)
  backend.emit('admin_dashboard_refresh')
  await page.clock.runFor(800)
  await expect(screen).not.toHaveAttribute('data-event')
  backend.setRows(nextRows.map((row) => row.user_id === users[0].user_id ? { ...row, is_published: true } : row))
  backend.emit('admin_dashboard_refresh')
  await page.clock.runFor(800)
  await expect(screen).toHaveAttribute('data-event', 'published')
  await expect(screen.locator(`[data-user-id="${users[0].user_id}"]`)).toHaveClass(/is-watch-spotlight/)
})

test('watch celebrates only confirmed platform fees and does not replay a duplicate', async ({ page }) => {
  const { backend, screen } = await openWatch(page)
  const revenueEvent = { id: 'watch-income', kind: 'transaction_fee', amount_cents: 160, currency: 'eur', occurred_at: new Date(await page.evaluate(() => Date.now())).toISOString(), store_id: 'store-3', store_name: 'Moreamoreceramics', description: 'Müügitasu' }
  await page.route('**/rpc/admin_revenue_dashboard', (route) => route.fulfill({ json: { month_total_cents: 37700, today_total_cents: 2280, subscription_total_cents: 29900, transaction_fee_total_cents: 8800, refund_total_cents: -1000, recent_events: [revenueEvent] } }))
  backend.emit('revenue_events', revenueEvent, 'INSERT')
  await page.clock.runFor(900)
  await expect(screen).toHaveAttribute('data-event', 'income')
  await expect(screen.locator('.watch-income__total > strong')).toHaveText('+1,60 €')
  await expect(screen.locator('.watch-receipts .is-spotlight')).toContainText('Moreamoreceramics')
  await screen.screenshot({ path: 'output/admin-watch-income.png', animations: 'disabled' })
  await page.clock.runFor(9500)
  backend.emit('revenue_events', revenueEvent, 'INSERT')
  await page.clock.runFor(900)
  await expect(screen).not.toHaveAttribute('data-event')
  await expect(screen.locator('.watch-income__total > strong')).toHaveText('377,00 €')
})

test('watch reports stale data and pauses when the tab is hidden', async ({ page }) => {
  const { backend, data, screen } = await openWatch(page)
  await expect(screen.locator('.watch-connection')).toHaveText('Otse')
  data.setMode('error')
  backend.emit('admin_homepage_refresh')
  await page.clock.runFor(800)
  await expect(screen.locator('.watch-connection')).toHaveText('Ühendus taastub')
  await expect(screen).not.toHaveAttribute('data-event')
  data.setMode('ready')
  backend.emit('admin_homepage_refresh')
  await page.clock.runFor(800)
  await expect(screen.locator('.watch-connection')).toHaveText('Otse')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(screen).toHaveCount(0)
  await page.clock.runFor(20_000)
  await expect(screen).toHaveCount(0)
  data.setAdded(9)
  backend.setRows(users.map((row, index) => index === 0 ? { ...row, is_published: true } : row))
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(3100)
  await expect(screen).toBeVisible()
  await expect(screen).not.toHaveAttribute('data-event')
  await expect(screen.locator('.watch-metrics > div').first()).toContainText('39')
})

test('watch brings an offscreen user into view on mobile without scrolling the working page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { backend, screen } = await openWatch(page, '/admin/users')
  const scrollBefore = await page.evaluate(() => window.scrollY)
  backend.setRows(users.map((row, index) => index === 7 ? { ...row, is_published: true } : row))
  backend.emit('admin_dashboard_refresh')
  await page.clock.runFor(2200)
  await expect(screen).toHaveAttribute('data-event', 'published')
  const row = screen.locator(`[data-user-id="${users[7].user_id}"]`)
  await expect(row).toHaveClass(/is-watch-spotlight/)
  await expect(row).toBeInViewport({ ratio: 1 })
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
  await screen.screenshot({ path: 'output/admin-watch-published-mobile.png', animations: 'disabled' })
})

test('watch keeps large real totals within their column', async ({ page }) => {
  const { backend, data, screen } = await openWatch(page)
  data.setAdded(999_970)
  backend.emit('admin_homepage_refresh')
  await page.clock.runFor(1800)
  await expect(screen).toHaveAttribute('data-event', 'visit')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await screen.locator('.watch-big-number').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  }
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`watch fits ${viewport.width}×${viewport.height} and respects reduced motion`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { screen } = await openWatch(page, '/admin/analytics', true)
    for (const scene of ['analytics', 'users', 'income']) {
      await expect(screen).toHaveAttribute('data-scene', scene)
      expect(await screen.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      await expect(screen.getByRole('button', { name: 'Lõpeta vaatlusrežiim' })).toBeInViewport()
      await expect(screen.locator('.watch-footer')).toBeInViewport()
      await expect(screen).toHaveCSS('animation-name', 'none')
      await screen.screenshot({ path: `output/admin-watch-${scene}-${viewport.width}.png`, animations: 'disabled' })
      await page.clock.runFor(16_200)
    }
    await screen.getByRole('button', { name: 'Lõpeta vaatlusrežiim' }).click()
    await expect(screen).toHaveCount(0)
  })
}

test('payment reasons expose incomplete onboarding without Stripe errors and preserve the last snapshot on failure', async ({ page }) => {
  await installBackend(page)
  let fail = false
  let ready = false
  const live = paymentFixture(0, 'stripe', { checkedAt: '2026-10-01T11:00:00Z', chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false,
    dueCount: 10, disabledReason: 'requirements.past_due', identityError: 'Täienda Stripe’is konto omaniku andmeid ja proovi uuesti.', issues: [],
    dueFields: ['business_profile.mcc', 'company.name', 'company.address.city', 'company.tax_id', 'owners.first_name', 'owners.dob.day', 'owners.dob.month', 'external_account', 'tos_acceptance.date', 'person_test.email'],
  })
  await page.route('**/functions/v1/admin-payment-status', (route) => {
    const body = route.request().postDataJSON()
    if (body.action === 'snapshot') return route.fulfill({ json: { diagnostics: [{ ...live, source: 'saved', dueFields: null }] } })
    if (fail) return route.fulfill({ status: 502, json: { error: 'Stripe’i seisu ei õnnestunud laadida.' } })
    return route.fulfill({ json: { diagnostic: ready ? { ...live, detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true, identityError: null, disabledReason: null, dueCount: 0, dueFields: [] } : live } })
  })
  await page.goto('/admin/users')
  const row = page.locator('.admin-user-row').first()
  await expect(row.locator('.admin-user-row__payment')).toHaveText('Stripe’i seadistus pooleli')
  await row.getByRole('button', { name: 'Angel Airshe: üksikasjad' }).click()
  const detail = row.getByRole('region', { name: 'Maksete põhjus' })
  await expect(detail.getByRole('heading')).toHaveText('Stripe’i seadistus pooleli')
  await expect(detail.getByText('Stripe’ist kontrollitud:', { exact: false })).toBeVisible()
  await expect(detail.locator('dt')).toHaveText(['Tegevusandmed', 'Ettevõte', 'Pangakonto', 'Omanikud', 'Isik 1', 'Tingimused'])
  await expect(detail).toContainText('väljamaksete pangakonto')
  await expect(detail).toContainText('sünnikuupäev')
  await expect(detail.getByRole('link', { name: 'Stripe', exact: true })).toHaveAttribute('href', 'https://dashboard.stripe.com/connect/accounts/acct_fixture')
  await detail.locator('summary').click()
  await expect(detail.getByText('company.tax_id', { exact: true })).toBeVisible()
  await detail.locator('summary').click()
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    if (width !== 320) await detail.screenshot({ path: `output/admin-payment-reason-${width}.png`, animations: 'disabled' })
  }
  fail = true
  await detail.getByRole('button', { name: 'Uuenda', exact: true }).click()
  await expect(detail.getByRole('status')).toContainText('viimane teadaolev seis')
  await expect(detail).toContainText('väljamaksete pangakonto')
  fail = false; ready = true
  await detail.getByRole('button', { name: 'Uuenda', exact: true }).click()
  await expect(detail.getByRole('heading')).toHaveText('Aktiivne')
  await expect(row.locator('.admin-user-row__payment')).toHaveText('Aktiivne')
  await expect(detail.locator('.admin-payment-requirements')).toHaveCount(0)
})

test('payment badges keep their reason during delayed refreshes and apply confirmed changes', async ({ page }) => {
  const backend = await installBackend(page)
  const metrics = structuredClone(userMetrics)
  metrics[0].payment_state = 'restricted'
  backend.setMetrics(metrics)
  let held = false
  let ready = false
  let checkedAt = ago(1)
  const pending: Route[] = []
  const respond = (route: Route) => {
    const snapshot = route.request().postDataJSON().action === 'snapshot'
    const diagnostic = paymentFixture(0, snapshot ? 'saved' : 'stripe', {
      checkedAt, detailsSubmitted: snapshot ? null : ready, chargesEnabled: ready, payoutsEnabled: ready,
      disabledReason: ready ? null : 'requirements.past_due', dueCount: ready ? 0 : 1,
      dueFields: snapshot ? null : ready ? [] : ['external_account'], issues: [],
    })
    return route.fulfill({ json: snapshot ? { diagnostics: [diagnostic] } : { diagnostic } })
  }
  await page.route('**/functions/v1/admin-payment-status', (route) => {
    if (held) { pending.push(route); return }
    return respond(route)
  })
  await page.goto('/admin/users')
  const row = page.locator('.admin-user-row').first()
  const badge = row.locator('.admin-user-row__payment button')
  await expect(badge).toHaveText('Stripe’i seadistus pooleli')
  await expect.poll(() => backend.subscriptions.has('admin_dashboard_refresh')).toBe(true)
  await badge.hover()
  await expect(badge).toHaveCSS('filter', 'none')

  // The dashboard answers before the delayed diagnosis. Its check timestamp
  // advances, but there must be no intermediate "reason unchecked" state.
  held = true
  checkedAt = ago(0)
  metrics[0].payment_checked_at = checkedAt
  backend.setMetrics(structuredClone(metrics))
  backend.emit('admin_dashboard_refresh')
  await expect.poll(() => pending.length).toBeGreaterThan(0)
  await expect(badge).toHaveText('Stripe’i seadistus pooleli')
  held = false
  await Promise.all(pending.splice(0).map(respond))
  await badge.click()
  const detail = row.getByRole('region', { name: 'Maksete põhjus' })
  await expect(badge).toHaveText('Pangakonto puudu')
  await expect(detail).toContainText('väljamaksete pangakonto')

  // A newer summary for the same restriction must not overwrite the more
  // precise live reason while its own Stripe refresh is still pending.
  held = true
  checkedAt = ago(-1)
  metrics[0].payment_checked_at = checkedAt
  backend.setMetrics(structuredClone(metrics))
  backend.emit('admin_dashboard_refresh')
  await expect.poll(() => pending.filter((route) => route.request().postDataJSON().action === 'snapshot').length).toBeGreaterThan(0)
  await expect.poll(() => pending.filter((route) => !route.request().postDataJSON().action).length).toBeGreaterThan(0)
  for (const route of pending.splice(0).filter((route) => {
    if (route.request().postDataJSON().action === 'snapshot') return true
    pending.push(route); return false
  })) await respond(route)
  await expect(badge).toHaveText('Pangakonto puudu')
  await expect(detail).toContainText('väljamaksete pangakonto')
  held = false
  await Promise.all(pending.splice(0).map(respond))

  ready = true
  checkedAt = ago(-2)
  metrics[0].payment_state = 'active'
  metrics[0].payment_checked_at = checkedAt
  backend.setMetrics(structuredClone(metrics))
  backend.emit('admin_dashboard_refresh')
  await expect(badge).toHaveText('Aktiivne')
  await expect(detail.getByRole('heading')).toHaveText('Aktiivne')
})

test('payment reasons distinguish verification in progress from an unspecified restriction', async ({ page }) => {
  await installBackend(page)
  let pending = true
  await page.route('**/functions/v1/admin-payment-status', (route) => {
    const body = route.request().postDataJSON()
    if (body.action === 'snapshot') return route.fulfill({ json: { diagnostics: [] } })
    return route.fulfill({ json: { diagnostic: paymentFixture(0, 'stripe', { chargesEnabled: false, payoutsEnabled: false, dueCount: 0,
      dueFields: [], identityError: null, issues: [], pendingVerification: pending, pendingFields: pending ? ['company.verification.document'] : [],
      disabledReason: pending ? 'requirements.pending_verification' : null,
    }) } })
  })
  await page.goto('/admin/users')
  await page.getByRole('button', { name: 'Angel Airshe: üksikasjad' }).click()
  const detail = page.getByRole('region', { name: 'Maksete põhjus' })
  await expect(detail.getByRole('heading')).toHaveText('Stripe kontrollib andmeid')
  await expect(detail).toContainText('Kontrollimisel: ettevõte (tõendusdokument)')
  await expect(detail).not.toContainText('Täienda')
  pending = false
  await detail.getByRole('button', { name: 'Uuenda', exact: true }).click()
  await expect(detail.getByRole('heading')).toHaveText('Põhjus täpsustamata')
  await expect(detail).toContainText('Stripe pole maksete piirangu täpset põhjust tagastanud')
})

const previewImage = (name: string) => `http://localhost:4174/storage/v1/object/public/product-images/${name}.webp`

async function installProductPreview(page: Page, total = 2) {
  const requests: { target_store_id: string; page_offset: number }[] = []
  const products = Array.from({ length: total }, (_, i) => ({
    id: `product-${i}`, name: i === 0 ? 'Käsitööna valminud keraamika' : `Toode ${i + 1}`,
    image_url: previewImage(`product-${i}`), alt: `Toote ${i + 1} pilt`,
    gallery: i === 0 ? [previewImage('product-0'), previewImage('detail')] : [],
  }))
  let fail = false
  await page.route('**/rpc/admin_store_products', (route) => {
    const body = route.request().postDataJSON()
    requests.push(body)
    return fail ? route.fulfill({ status: 503, json: { message: 'Unavailable' } }) : route.fulfill({ json: {
      version: 1, store_id: body.target_store_id, offset: body.page_offset, total: products.length,
      products: products.slice(body.page_offset, body.page_offset + 48),
    } })
  })
  await page.route('**/storage/v1/object/public/product-images/**', (route) => route.fulfill({
    path: 'public/images/kaubamaja-example-ceramics.webp', contentType: 'image/webp',
  }))
  return { requests, products, fail: (value: boolean) => { fail = value } }
}

test('product preview opens draft store photos, changes products and restores keyboard focus', async ({ page }) => {
  await installBackend(page)
  const backend = await installProductPreview(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/admin/users')
  const expand = page.getByRole('button', { name: 'Angel Airshe: üksikasjad' })
  await expand.click()
  const opener = page.getByRole('button', { name: 'Tooted', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Angel Airshe' })
  await expect(dialog).toBeVisible()
  const image = dialog.locator('.admin-product-preview__image > img')
  await expect(image).toHaveAttribute('src', previewImage('product-0'))
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  await expect(dialog.getByRole('button', { name: 'Eelmine toode' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Sulge tootepildid' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Järgmine toode' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Sulge tootepildid' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Pilt 2' }).click()
  await expect(image).toHaveAttribute('src', previewImage('detail'))
  await dialog.getByRole('button', { name: 'Järgmine toode' }).click()
  await expect(dialog.getByRole('heading', { name: 'Toode 2' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Järgmine toode' })).toBeDisabled()
  await page.keyboard.press('ArrowLeft')
  await expect(image).toHaveAttribute('src', previewImage('product-0'))
  await page.screenshot({ path: 'output/admin-product-preview-1440.png' })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(expand).toHaveAttribute('aria-expanded', 'true')
  await expect(opener).toBeFocused()
  await page.getByRole('button', { name: 'Vaata tooteid' }).click()
  await expect(dialog).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(dialog).not.toBeVisible()
  expect(backend.requests).toEqual(Array(2).fill({ target_store_id: 'store-0', page_offset: 0 }))

  await page.setViewportSize({ width: 390, height: 844 })
  await opener.click()
  await expect(image).toBeVisible()
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
  const photoBounds = await image.boundingBox()
  expect(photoBounds!.height).toBeGreaterThan(300)
  await page.screenshot({ path: 'output/admin-product-preview-390.png' })
  await dialog.getByRole('button', { name: 'Sulge tootepildid' }).click()
  await expect(opener).toBeFocused()
})

test('product preview retries failed requests and handles missing and broken photos', async ({ page }) => {
  await installBackend(page)
  const backend = await installProductPreview(page, 1)
  backend.fail(true)
  await page.goto('/admin/users')
  await page.getByRole('button', { name: 'Angel Airshe: üksikasjad' }).click()
  await page.getByRole('button', { name: 'Tooted', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Tooteid ei õnnestunud laadida')).toBeVisible()
  backend.fail(false)
  backend.products[0].image_url = ''
  backend.products[0].gallery = []
  await dialog.getByRole('button', { name: 'Proovi uuesti' }).click()
  await expect(dialog.getByText('Pilt puudub')).toBeVisible()
  await page.keyboard.press('Escape')
  backend.products[0].image_url = previewImage('broken')
  await page.route('**/product-images/broken.webp', (route) => route.fulfill({ status: 404 }))
  await page.getByRole('button', { name: 'Tooted', exact: true }).click()
  await expect(dialog.getByText('Pilti ei õnnestunud laadida')).toBeVisible()
  await page.keyboard.press('Escape')
  backend.products.length = 0
  await page.getByRole('button', { name: 'Tooted', exact: true }).click()
  await expect(dialog.getByText('Tooteid pole veel lisatud')).toBeVisible()
})

test('product preview loads additional pages without cutting off products', async ({ page }) => {
  await installBackend(page)
  const backend = await installProductPreview(page, 49)
  await page.goto('/admin/users')
  await page.getByRole('button', { name: 'Angel Airshe: üksikasjad' }).click()
  await page.getByRole('button', { name: 'Tooted', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Järgmine toode' })).toBeEnabled()
  for (let i = 1; i < 49; i++) await page.keyboard.press('ArrowRight')
  await expect(dialog.getByRole('heading', { name: 'Toode 49' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Järgmine toode' })).toBeDisabled()
  expect(backend.requests.map((request) => request.page_offset)).toEqual([0, 48])
  await page.keyboard.press('ArrowLeft')
  await expect(dialog.getByRole('heading', { name: 'Toode 48' })).toBeVisible()
  expect(backend.requests.map((request) => request.page_offset)).toEqual([0, 48, 0])
})

test('admin starts a support conversation from a user and sees refreshed support status', async ({ page }) => {
  const backend = await installBackend(page)
  const sent: Record<string, unknown>[] = []
  const conversationId = '90000000-0000-4000-8000-000000000001'
  await page.route('**/support_conversations?*', (route) => {
    expect(new URL(route.request().url()).searchParams.get('user_id')).toBe(`eq.${users[0].user_id}`)
    return route.fulfill({ json: [{ id: 'old-conversation', subject: 'Varasem küsimus', status: 'resolved', last_message_at: ago(24) }] })
  })
  await page.route('**/functions/v1/support-actions', (route) => {
    sent.push(route.request().postDataJSON())
    const metrics = structuredClone(userMetrics)
    metrics[0].waiting_user_count = 1
    backend.setMetrics(metrics)
    return route.fulfill({ json: { id: conversationId, conversation_id: conversationId } })
  })
  await page.goto('/admin/users')
  const row = page.locator('.admin-user-row').first()
  await row.getByRole('button', { name: 'Angel Airshe: üksikasjad' }).click()
  const trigger = row.getByRole('button', { name: 'Kirjuta kasutajale' })
  await trigger.click()
  const panel = page.getByRole('dialog', { name: 'Kirjuta kasutajale' })
  await expect(panel).toContainText('artist@example.invalid')
  await expect(panel.getByRole('button', { name: 'Saada kiri' })).toBeDisabled()
  await expect(panel.getByLabel('Teema', { exact: true })).toBeFocused()
  await panel.getByText('Varasemad vestlused', { exact: false }).click()
  await expect(panel.getByRole('link', { name: /Varasem küsimus/ })).toHaveAttribute('href', '/admin/support?conversation=old-conversation')
  await panel.getByLabel('Teema', { exact: true }).fill('Abi poe seadistamisel')
  await panel.getByLabel('Sõnum', { exact: true }).fill('Tere! Kas saan aidata poe maksed tööle saada?')
  await panel.getByRole('button', { name: 'Saada kiri' }).click()
  await expect(panel.getByRole('heading', { name: 'Kiri saadetud' })).toBeVisible()
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({ action: 'admin_create', user_id: users[0].user_id, subject: 'Abi poe seadistamisel', body: 'Tere! Kas saan aidata poe maksed tööle saada?' })
  expect(sent[0].request_id).toMatch(/^[0-9a-f-]{36}$/)
  await expect(panel.getByRole('link', { name: 'Ava vestlus' })).toHaveAttribute('href', `/admin/support?conversation=${conversationId}`)
  await expect(row.locator('.admin-user-row__support')).toContainText('Ootab kasutajat')
  await panel.getByRole('button', { name: 'Valmis' }).click()
  await expect(trigger).toBeFocused()
  await expect(row).toHaveClass(/is-expanded/)
  await trigger.click()
  await expect(panel.getByLabel('Teema', { exact: true })).toHaveValue('')
})

test('admin message retry retains the exact request and blocks duplicate submission', async ({ page }) => {
  await installBackend(page)
  const requests: Record<string, unknown>[] = []
  let pending: Route | undefined
  await page.route('**/functions/v1/support-actions', (route) => {
    requests.push(route.request().postDataJSON())
    pending = route
  })
  await page.goto('/admin/users')
  const row = page.locator('.admin-user-row').first()
  await row.getByRole('button', { name: 'Angel Airshe: üksikasjad' }).click()
  await row.getByRole('button', { name: 'Kirjuta kasutajale' }).click()
  const panel = page.getByRole('dialog')
  await panel.getByLabel('Teema', { exact: true }).fill('Abi maksetega')
  await panel.getByLabel('Sõnum', { exact: true }).fill('Tere! Aitan maksete seadistamisel.')
  await panel.getByRole('button', { name: 'Saada kiri' }).click()
  await expect.poll(() => requests.length).toBe(1)
  await expect(panel.getByRole('button', { name: 'Saadan…' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(panel).toBeVisible()
  await pending!.fulfill({ status: 502, json: { error: 'Saatmine ebaõnnestus. Proovi uuesti.', conversation_id: requests[0].request_id } })
  await expect(panel.getByRole('alert')).toContainText('Saatmine ebaõnnestus')
  await expect(panel.getByLabel('Sõnum', { exact: true })).toHaveValue('Tere! Aitan maksete seadistamisel.')
  await panel.getByRole('button', { name: 'Sulge kirjutamispaneel' }).click()
  await row.getByRole('button', { name: 'Kirjuta kasutajale' }).click()
  await panel.getByRole('button', { name: 'Proovi saatmist uuesti' }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[1]).toEqual(requests[0])
  await pending!.fulfill({ json: { id: requests[0].request_id, conversation_id: requests[0].request_id } })
  await expect(panel.getByRole('heading', { name: 'Kiri saadetud' })).toBeVisible()
})

test('message panel fits desktop and mobile, traps focus and closes without collapsing the user', async ({ page }) => {
  await installBackend(page)
  await page.goto('/admin/users')
  const row = page.locator('.admin-user-row').first()
  await row.getByRole('button', { name: 'Angel Airshe: üksikasjad' }).click()
  const trigger = row.getByRole('button', { name: 'Kirjuta kasutajale' })
  await trigger.click()
  const panel = page.getByRole('dialog')
  await panel.getByLabel('Teema', { exact: true }).fill('Abi poe seadistamisel')
  await panel.getByLabel('Sõnum', { exact: true }).fill('Tere! Kas saan aidata sinu poe maksed tööle saada?\n\nMarek\nPoeruum')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await expect(panel.getByRole('button', { name: 'Saada kiri' })).toBeInViewport()
    if (width !== 320) await panel.screenshot({ path: `output/admin-user-message-${width}.png`, animations: 'disabled' })
  }
  await panel.getByRole('button', { name: 'Saada kiri' }).focus()
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('button', { name: 'Sulge kirjutamispaneel' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await expect(row).toHaveClass(/is-expanded/)
})
