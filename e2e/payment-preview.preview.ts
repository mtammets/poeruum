import { expect, test, type Page } from '@playwright/test'

async function openPublicationPreview(page: Page, paymentState: 'idle' | 'incomplete' | 'reviewing' | 'connected') {
  const response = await page.request.post('/__preview/sessions', { data: { kind: 'app', screen: 'publish', paymentState } })
  expect(response.ok()).toBe(true)
  const session = await response.json()
  await page.goto(session.url)
  await expect(page.locator('.publish-step')).toBeVisible()
  return page
}

test('real app screens are available without signup and use isolated fixtures', async ({ page }) => {
  const externalWrites: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /supabase\.co|api\.stripe\.com/.test(request.url())) externalWrites.push(request.url())
  })
  await page.goto('/previews/payments.html')
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'Ühenda poe maksed' })).toBeVisible()
  await page.getByLabel('Maksete olukord').selectOption('reviewing')
  await expect(frame.getByText('Stripe kontrollib andmeid', { exact: true })).toBeVisible()
  await frame.getByRole('button', { name: /Jätka tarnega/ }).click()
  await expect(frame.getByRole('heading', { name: 'Vali tarneviisid' })).toBeVisible()
  await page.getByRole('button', { name: /Müüja andmed/ }).click()
  await expect(frame.getByRole('heading', { name: 'Müüja andmed' })).toBeVisible()
  await frame.getByLabel('Ettevõtte nimi', { exact: true }).fill('Muudetud näidis')
  await frame.getByRole('button', { name: /Jätka maksetega/ }).click()
  await page.getByRole('button', { name: /Alusta uuesti/ }).click()
  await expect(frame.getByLabel('Ettevõtte nimi', { exact: true })).toHaveValue('Näidise Käsitöö OÜ')
  await page.getByRole('button', { name: /Esimene toode/ }).click()
  await expect(frame.getByRole('textbox', { name: 'Toote nimi', exact: true })).toBeVisible()
  await expect(frame.getByRole('button', { name: 'Lisa foto', exact: true })).toBeVisible()
  await expect(frame.getByLabel('Esimese toote seadistamine')).toHaveCount(0)
  expect(externalWrites).toEqual([])
})

for (const mobile of [true, false]) {
  test(`hosted Stripe opens the whole tab and restores the ${mobile ? 'phone' : 'desktop'} payment preview`, async ({ page, context, request }) => {
    let sessionsCreated = 0
    let starts = 0
    let statuses = 0
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/__preview/sessions' && request.method() === 'POST') sessionsCreated++
    })
    await page.goto('/previews/payments.html')
    const frame = page.frameLocator('iframe')
    await expect(frame.getByRole('heading', { name: 'Ühenda poe maksed' })).toBeVisible()
    await page.getByRole('button', { name: mobile ? 'Telefon' : 'Arvuti', exact: true }).click()
    await page.getByRole('button', { name: /Müüja andmed/ }).click()
    await frame.getByLabel('Ettevõtte nimi', { exact: true }).fill('Minu testpood OÜ')
    await frame.getByRole('button', { name: 'Jätka maksetega' }).click()
    await expect(frame.getByRole('heading', { name: 'Ühenda poe maksed' })).toBeVisible()
    const originalUrl = page.url()
    const id = new URL(originalUrl).searchParams.get('session')!
    const data = await (await request.get(`/__preview/sessions/${id}/data`)).json()
    const originalSessions = sessionsCreated
    const ready = mobile
    await page.route('**/functions/v1/stripe-connect', route => {
      const body = route.request().postDataJSON()
      if (body.action === 'hosted-start') {
        expect(body.storeId).toBe(data.store.id)
        starts++
        return route.fulfill({ json: { url: 'https://connect.stripe.com/setup/payment-preview-test', storeId: body.storeId } })
      }
      if (body.action === 'status' && starts) {
        statuses++
        return route.fulfill({ json: { status: ready ? 'connected' : 'pending', chargesEnabled: ready, payoutsEnabled: ready,
          detailsSubmitted: ready, requirements: { dueCount: ready ? 0 : 2, pastDue: false, pendingVerification: false, issues: [] } } })
      }
      return route.continue()
    })
    await page.route('**/rest/v1/stores?*', async route => {
      if (!starts || route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const data = await response.json()
      const update = (store: Record<string, unknown>) => ({ ...store, stripe_account_id: 'acct_preview_test', stripe_connection_type: 'hosted',
        stripe_account_mode: 'test', payment_status: ready ? 'connected' : 'pending', stripe_account_charges_enabled: ready,
        stripe_account_payouts_enabled: ready, stripe_account_requirements_due_count: ready ? 0 : 2 })
      return route.fulfill({ response, json: Array.isArray(data) ? data.map(update) : update(data) })
    })
    await page.route('https://connect.stripe.com/setup/payment-preview-test', route => route.fulfill({
      contentType: 'text/html', headers: { 'Content-Security-Policy': "frame-ancestors 'none'" },
      body: '<h1>Stripe test</h1><a href="http://127.0.0.1:4186/stripe/connect/return">Tagasi eelvaatesse</a>',
    }))
    await frame.getByRole('button', { name: 'Seadista maksed', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Stripe test' })).toBeVisible()
    expect(context.pages()).toHaveLength(1)
    await page.getByRole('link', { name: 'Tagasi eelvaatesse' }).click()
    await expect(page).toHaveURL(originalUrl)
    const restored = ready ? frame.getByText('Maksed on valmis', { exact: true }) : frame.getByRole('button', { name: 'Jätka maksete seadistamist' })
    await expect(restored).toBeVisible()
    await expect(page.getByRole('button', { name: mobile ? 'Telefon' : 'Arvuti', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('iframe')).toHaveAttribute('src', `/?preview_session=${id}`)
    await page.reload()
    await expect(restored).toBeVisible()
    expect(starts).toBe(1)
    expect(statuses).toBeGreaterThan(0)
    expect(sessionsCreated).toBe(originalSessions)
    expect((await (await request.get(`/__preview/sessions/${id}/data`)).json()).store.settings.businessName).toBe('Minu testpood OÜ')
    await page.getByRole('button', { name: /Alusta uuesti/ }).click()
    await expect(frame.getByLabel('Ettevõtte nimi', { exact: true })).toHaveValue('Näidise Käsitöö OÜ')
    expect(new URL(page.url()).searchParams.get('session')).not.toBe(id)
  })
}

test('expired payment preview requires an explicit restart', async ({ page }) => {
  await page.goto('/previews/payments.html?session=00000000-0000-4000-8000-000000000000&phone=0')
  await expect(page.getByRole('alert')).toContainText('Eelvaate katse aegus')
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.getByRole('button', { name: /Alusta uuesti/ }).click()
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Ühenda poe maksed' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Arvuti', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

for (const paymentState of ['idle', 'incomplete'] as const) {
  test(`publication directs ${paymentState} payments back to setup`, async ({ page }) => {
    const publicationRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/rest/v1/rpc/publish_store')) publicationRequests.push(request.url())
    })
    const frame = await openPublicationPreview(page, paymentState)
    await expect(frame.locator('.publish-ready__copy')).toContainText('Avalda pood')
    await frame.getByRole('button', { name: 'Lõpeta maksete seadistamine', exact: true }).click()
    await expect(frame.getByRole('heading', { name: 'Ühenda poe maksed' })).toBeVisible()
    await expect(frame.getByRole('alert')).toHaveCount(0)
    expect(publicationRequests).toEqual([])
  })
}

test('publication waits for Stripe and refreshing never publishes automatically', async ({ page }) => {
  const publicationRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/rest/v1/rpc/publish_store')) publicationRequests.push(request.url())
  })
  const frame = await openPublicationPreview(page, 'reviewing')
  await expect(frame.getByRole('button', { name: /Avalda pood/ })).toBeDisabled()
  await expect(frame.locator('.publish-waiting')).toContainText('Saad poe avaldada, kui maksed on aktiveeritud')
  const refreshResponse = page.waitForResponse((response) => response.url().endsWith('/functions/v1/stripe-connect') && response.request().postDataJSON()?.action === 'status')
  await frame.getByRole('button', { name: 'Uuenda olekut', exact: true }).click()
  expect((await refreshResponse).ok()).toBe(true)
  await expect(frame.getByRole('button', { name: 'Uuenda olekut', exact: true })).toBeEnabled()
  await expect(frame.getByRole('button', { name: /Avalda pood/ })).toBeDisabled()
  await expect(frame.getByRole('alert')).toHaveCount(0)

  await page.route('**/functions/v1/stripe-connect', async (route) => {
    const response = await route.fetch()
    const status = await response.json()
    await route.fulfill({ response, json: { ...status, status: 'connected', chargesEnabled: true, payoutsEnabled: true } })
  })
  await frame.getByRole('button', { name: 'Uuenda olekut', exact: true }).click()
  await expect(frame.getByRole('button', { name: /Avalda pood/ })).toBeEnabled()
  await expect(frame.locator('.publish-waiting')).toHaveCount(0)
  await expect(frame.locator('.publish-ready__copy')).toContainText('Avalda pood')
  expect(publicationRequests).toEqual([])
})

test('publication keeps waiting when refreshing the payment status fails', async ({ page }) => {
  const frame = await openPublicationPreview(page, 'reviewing')
  await expect(frame.getByRole('button', { name: /Avalda pood/ })).toBeDisabled()
  await page.route('**/functions/v1/stripe-connect', (route) => route.fulfill({ status: 500, json: { error: 'Maksete olekut ei saanud uuendada.' } }))
  await frame.getByRole('button', { name: 'Uuenda olekut', exact: true }).click()
  await expect(frame.getByRole('alert')).toContainText('Maksete olekut ei saanud uuendada')
  await expect(frame.getByRole('button', { name: /Avalda pood/ })).toBeDisabled()
  await expect(frame.getByRole('button', { name: 'Uuenda olekut', exact: true })).toBeEnabled()
})

test('active payments allow the merchant to publish explicitly', async ({ page }) => {
  const frame = await openPublicationPreview(page, 'connected')
  await frame.getByRole('button', { name: 'Avalda pood', exact: false }).click()
  await expect(frame.getByRole('button', { name: 'Seaded', exact: true })).toBeVisible()
})

test('missing test credentials explain setup and never fall back to production', async ({ page, request }) => {
  await page.goto('/previews/payments.html')
  await page.getByRole('button', { name: 'Stripe’i vorm', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ühenda Stripe’i testkeskkond' })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  const config = await request.get('/__preview/config')
  expect(await config.json()).toEqual({ ready: false, publishableKey: '' })
  const rejected = await request.post('/__preview/sessions', { data: { kind: 'stripe' } })
  expect(rejected.status()).toBe(400)
})

test('phone preview uses an actual narrow viewport and fits a phone browser', async ({ page }) => {
  await page.goto('/previews/payments.html')
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'Ühenda poe maksed' })).toBeVisible()
  expect(await frame.locator('body').evaluate(() => window.innerWidth)).toBe(390)
  await page.getByRole('button', { name: 'Arvuti', exact: true }).click()
  expect(await frame.locator('body').evaluate(() => window.innerWidth)).toBeGreaterThan(800)
  await page.getByRole('button', { name: 'Telefon', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('cross-origin control calls and unknown operations are rejected', async ({ request }) => {
  const rejected = await request.post('/__preview/sessions', { headers: { Origin: 'https://example.com' }, data: {} })
  expect(rejected.status()).toBe(403)
  const unknown = await request.post('/__preview/delete-live-account', { data: { account: 'acct_external' } })
  expect(unknown.status()).toBe(404)
})
