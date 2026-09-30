import { expect, test, type FrameLocator, type Page } from '@playwright/test'

async function addFirstProduct(page: Page, frame: FrameLocator) {
  await expect(frame.getByRole('heading', { name: 'Lisa esimene toode' })).toHaveCount(0)
  await frame.getByRole('textbox', { name: 'Toote nimi', exact: true }).fill('Minu esimene toode')
  await frame.getByRole('textbox', { name: 'Toote tavahind', exact: true }).fill('25')
  const chooser = page.waitForEvent('filechooser')
  await frame.getByRole('button', { name: 'Lisa foto', exact: true }).click()
  await (await chooser).setFiles('public/images/kaubamaja-example-art.webp')
  await expect(frame.getByRole('button', { name: 'Salvesta ja jätka', exact: true })).toBeEnabled()
  await expect(frame.getByRole('textbox', { name: 'Toote nimi', exact: true })).toHaveText('Minu esimene toode')
  await expect(frame.getByRole('textbox', { name: 'Toote tavahind', exact: true })).toHaveValue('25')
  await frame.getByRole('button', { name: 'Salvesta ja jätka', exact: true }).click()
  await expect(frame.locator('.publish-step')).toBeVisible()
  await expect(frame.locator('.publish-seller-row').last()).toContainText('1 toode')
}

async function open(page: Page) {
  await page.goto('/previews/sellers.html')
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'Poe nimi', exact: true })).toBeVisible()
  await frame.getByRole('button', { name: /Jätka/ }).click()
  await expect(frame.getByRole('heading', { name: 'Müüja andmed' })).toBeVisible()
  await expect(frame.getByRole('checkbox', { name: 'Kinnitan, et kasutan enda aktiivset LHV ettevõtluskontot', exact: false })).not.toBeChecked()
  await frame.getByRole('checkbox', { name: 'Kinnitan, et kasutan enda aktiivset LHV ettevõtluskontot', exact: false }).check()
  return frame
}

test('first product editor can be left without creating a product', async ({ page, request }) => {
  const response = await request.post('/__preview/sessions', { data: { screen: 'product', sellerPreview: true, sellerType: 'entrepreneur' } })
  const session = await response.json()
  await page.goto(session.url)
  await expect(page.getByRole('textbox', { name: 'Toote nimi', exact: true })).toBeEmpty()
  await page.getByRole('button', { name: 'Loobu muudatustest' }).click()
  await expect(page.getByRole('heading', { name: 'Vali tarneviisid' })).toBeVisible()
  expect((await (await request.get(`/__preview/sessions/${session.id}/data`)).json()).products).toEqual([])
})

test('first product validates required fields and retries saving and continuation without duplicates', async ({ page, request }) => {
  const response = await request.post('/__preview/sessions', { data: { screen: 'product', sellerPreview: true, sellerType: 'entrepreneur' } })
  const session = await response.json()
  await page.goto(session.url)
  const save = page.getByRole('button', { name: 'Salvesta ja jätka', exact: true })
  await save.click()
  await expect(page.getByText('Lisa toote nimi', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Toote nimi', exact: true }).fill('Minu maal')
  await page.getByRole('textbox', { name: 'Toote tavahind' }).fill('35')
  await save.click()
  await expect(page.getByText('Lisa vähemalt üks tootepilt', { exact: true })).toBeVisible()
  expect((await (await request.get(`/__preview/sessions/${session.id}/data`)).json()).products).toEqual([])
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Lisa foto', exact: true }).click()
  await (await chooser).setFiles('public/images/kaubamaja-example-art.webp')
  await expect(save).toBeEnabled()
  let failSave = true
  let failContinue = true
  await page.route('**/rest/v1/products?*', route => {
    if (route.request().method() === 'POST' && failSave) {
      failSave = false
      return route.fulfill({ status: 503, json: { message: 'Salvestamine katkes. Proovi uuesti.' } })
    }
    return route.continue()
  })
  await page.route('**/rest/v1/stores?*', route => {
    if (route.request().method() === 'PATCH' && route.request().postDataJSON()?.settings?.onboardingStep === 'publish' && failContinue) {
      failContinue = false
      return route.fulfill({ status: 503, json: { message: 'Jätkamine katkes. Proovi uuesti.' } })
    }
    return route.continue()
  })
  await save.click()
  await expect(page.getByText('Salvestamine katkes. Proovi uuesti.', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Toote nimi', exact: true })).toHaveText('Minu maal')
  await save.click()
  await expect(page.getByText('Jätkamine katkes. Proovi uuesti.', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Toote tavahind' })).toHaveValue('35')
  await save.click()
  await expect(page.locator('.publish-step')).toBeVisible()
  const data = await (await request.get(`/__preview/sessions/${session.id}/data`)).json()
  expect(data.products).toHaveLength(1)
  expect(data.products[0]).toMatchObject({ name: 'Minu maal', price: 35 })
  expect(data.store.is_published).toBe(false)
})

test('seller kinds show only their required fields and reject incomplete identity', async ({ page }) => {
  const frame = await open(page)
  await expect(frame.getByLabel('Eesnimi', { exact: true })).toHaveValue('Liisa')
  await expect(frame.getByLabel('Registrikood', { exact: true })).toHaveCount(0)
  await expect(frame.getByLabel('Olen käibemaksukohustuslane')).toHaveCount(0)
  await frame.getByLabel('Perekonnanimi', { exact: true }).fill('')
  await frame.getByRole('button', { name: 'Jätka maksetega' }).click()
  await expect(frame.getByRole('heading', { name: 'Müüja andmed' })).toBeVisible()
  await frame.getByRole('radio', { name: 'Ettevõte', exact: true }).check()
  await expect(frame.getByLabel('Registrikood', { exact: true })).toBeVisible()
  await expect(frame.getByLabel('Eesnimi', { exact: true })).toHaveCount(0)
  await frame.getByRole('radio', { name: 'Ettevõtluskontoga eraisik' }).check()
  await expect(frame.getByLabel('Eesnimi', { exact: true })).toHaveValue('Liisa')
})

test('seller preview cannot fake payment activation and publication waits for Stripe', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let frame = await open(page)
  await frame.getByRole('button', { name: 'Jätka maksetega' }).click()
  await expect(frame.getByText('Kinnita oma andmed.', { exact: true })).toBeVisible()
  await frame.getByRole('button', { name: 'Seadista maksed', exact: true }).click()
  await expect(frame.getByRole('alert')).toContainText('Maksete seadistamine pole praegu saadaval.')
  await expect(frame.getByRole('button', { name: 'Salvesta pangakonto' })).toHaveCount(0)
  const src = await page.locator('iframe').getAttribute('src')
  const session = new URL(src!, 'http://localhost').searchParams.get('preview_session')
  expect((await request.post(`/__preview/sessions/${session}/complete`, { data: { iban: 'EE382200221020145685' } })).status()).toBe(404)
  expect((await request.post(`/__preview/sessions/${session}/stripe`, { data: { action: 'start' } })).status()).toBe(400)
  frame = await open(page)
  await frame.getByRole('button', { name: 'Jätka maksetega' }).click()
  await frame.getByRole('button', { name: 'Jäta praegu vahele' }).click()
  await frame.getByRole('button', { name: 'Jätka esimese tootega' }).click()
  await expect(frame.getByLabel('Esimese toote seadistamine')).toHaveCount(0)
  await addFirstProduct(page, frame)
  await expect(frame.locator('.publish-seller-row').first()).toContainText('Liisa Tamm')
  await expect(frame.getByRole('button', { name: 'Lõpeta maksete seadistamine' })).toBeVisible()
  await expect(frame.getByRole('button', { name: /^Avalda pood/ })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('settings persist into the buyer view and both PDF documents render', async ({ page, request }) => {
  const frame = await open(page)
  await page.getByRole('button', { name: 'Ostja vaade', exact: true }).click()
  await expect(frame.getByRole('heading', { name: 'Tooteid veel pole' })).toBeVisible()
  await page.getByRole('button', { name: 'Poe loomine', exact: true }).click()
  await frame.getByRole('checkbox', { name: 'Kinnitan, et kasutan enda aktiivset LHV ettevõtluskontot', exact: false }).check()
  await frame.getByRole('button', { name: 'Jätka maksetega' }).click()
  await frame.getByRole('button', { name: 'Jäta praegu vahele' }).click()
  await frame.getByRole('button', { name: 'Jätka esimese tootega' }).click()
  await addFirstProduct(page, frame)
  await page.getByRole('button', { name: 'Müüja seaded', exact: true }).click()
  await frame.getByLabel('Eesnimi', { exact: true }).fill('Kadi')
  const saved = page.waitForResponse((response) => response.url().includes('/rest/v1/stores') && response.request().method() === 'PATCH')
  await frame.getByLabel('Kontakt-e-post', { exact: true }).focus()
  expect((await saved).ok()).toBe(true)
  await page.getByRole('button', { name: 'Ostja vaade', exact: true }).click()
  await expect(frame.getByRole('heading', { name: 'Minu esimene toode', exact: true })).toBeVisible()
  await frame.getByRole('button', { name: 'Müüja andmed', exact: true }).click()
  const details = frame.getByRole('dialog', { name: 'Müüja andmed' })
  await expect(details).toContainText('Kadi Tamm')
  await expect(details).not.toContainText('Registrikood')
  await expect(details).not.toContainText('Isikukood')
  const src = await page.locator('iframe').getAttribute('src')
  const session = new URL(src!, 'http://localhost').searchParams.get('session')
  for (const suffix of ['', '?kind=credit']) {
    const response = await request.get(`/__preview/sessions/${session}/document${suffix}`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/pdf')
    expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-')
  }
})

test('phone form fits the viewport and continues with the seller declaration', async ({ page }) => {
  const frame = await open(page)
  await page.getByRole('button', { name: 'Telefon', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  expect(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(frame.getByRole('checkbox')).toHaveCount(1)
  await expect(frame.getByRole('checkbox')).toBeChecked()
  await frame.getByRole('button', { name: 'Jätka maksetega' }).click()
  await expect(frame.getByRole('button', { name: 'Seadista maksed', exact: true })).toBeVisible()
  await frame.getByRole('button', { name: 'Jäta praegu vahele' }).click()
  await frame.getByRole('button', { name: 'Jätka esimese tootega' }).click()
  await addFirstProduct(page, frame)
  await expect(frame.locator('.publish-step')).toBeVisible()
})

async function hostedFlow(page: Page, ready: boolean, refresh = false) {
  let created = false
  let starts = 0
  let refreshes = 0
  let statuses = 0
  let failStatus = false
  let detailsSubmitted = ready
  const requirements = { dueCount: ready ? 0 : 2, pastDue: false, pendingVerification: false, issues: [] as Array<{ code: string; requirement: string }> }
  await page.route('**/functions/v1/stripe-connect', async route => {
    const body = route.request().postDataJSON()
    if (body.action === 'hosted-start' || body.action === 'hosted-refresh') {
      expect(body.returnOrigin).toBe('http://127.0.0.1:4188')
      expect(body.storeId).toBeTruthy()
      if (body.action === 'hosted-start') { created = true; starts++ } else { expect(created).toBe(true); refreshes++ }
      return route.fulfill({ json: { url: 'https://connect.stripe.com/setup/browser-test', storeId: body.storeId } })
    }
    if (body.action === 'status' && created) {
      statuses++
      if (failStatus) return route.fulfill({ status: 503, json: { error: 'Maksete olekut ei saanud kontrollida.' } })
      return route.fulfill({ json: { status: ready ? 'connected' : 'pending', chargesEnabled: ready, payoutsEnabled: ready, detailsSubmitted, requirements } })
    }
    return route.continue()
  })
  await page.route('**/rest/v1/stores?*', async route => {
    if (!created || route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const data = await response.json()
    const update = (store: Record<string, unknown>) => ({ ...store, stripe_account_id: 'acct_browser', stripe_connection_type: 'hosted', stripe_account_mode: 'test', payment_status: ready ? 'connected' : 'pending', stripe_account_charges_enabled: ready, stripe_account_payouts_enabled: ready, stripe_account_requirements_due_count: requirements.dueCount, stripe_account_requirement_issues: requirements.issues })
    return route.fulfill({ response, json: Array.isArray(data) ? data.map(update) : update(data) })
  })
  await page.route('https://connect.stripe.com/setup/browser-test', route => route.fulfill({ contentType: 'text/html', body: `<h1>Stripe test</h1><a href="http://127.0.0.1:4188/stripe/connect/return${refresh && refreshes === 0 ? '?refresh=1' : ''}">Return</a>` }))
  return {
    counts: () => ({ starts, refreshes, statuses }),
    setFailStatus: (value: boolean) => { failStatus = value },
    rejectIdentity: () => {
      detailsSubmitted = true
      requirements.pastDue = true
      requirements.issues = ['individual.first_name', 'individual.dob.day', 'individual.address.line1']
        .map(requirement => ({ code: 'verification_failed_keyed_identity', requirement }))
    },
  }
}

test('submitted identity that Stripe rejects shows the reason once and resumes the same account', async ({ page }) => {
  const frame = await open(page)
  await frame.getByRole('button', { name: 'Jätka maksetega' }).click()
  const flow = await hostedFlow(page, false)
  flow.rejectIdentity()
  const originalUrl = page.url()
  await frame.getByRole('button', { name: 'Seadista maksed', exact: true }).click()
  await page.getByRole('link', { name: 'Return' }).click()
  await expect(page).toHaveURL(originalUrl)
  await expect(frame.getByRole('heading', { name: 'Maksete kinnitamine' })).toBeVisible()
  await expect(frame.getByRole('alert')).toContainText('Esitatud isikuandmeid ei saanud kinnitada')
  await expect(frame.getByText('Esitatud isikuandmeid ei saanud kinnitada', { exact: true })).toHaveCount(1)
  await expect(frame.getByRole('alert')).not.toContainText('verification_failed_keyed_identity')
  await expect(frame.getByText('Maksed on valmis')).toHaveCount(0)
  await page.screenshot({ path: 'output/seller-preview/hosted-identity-rejected.png', fullPage: true })
  await frame.getByRole('button', { name: 'Kontrolli andmeid Stripe’is' }).click()
  await expect(page.getByRole('heading', { name: 'Stripe test' })).toBeVisible()
  expect(flow.counts().starts).toBe(2)
})

test('dedicated Stripe setup uses the same tab and returns to the same shop and phone view', async ({ page, context }) => {
  let frame = await open(page)
  await page.getByRole('button', { name: 'Telefon', exact: true }).click()
  await frame.getByRole('button', { name: 'Jätka maksetega' }).click()
  const originalUrl = page.url()
  const flow = await hostedFlow(page, true)
  await expect(frame.getByRole('button', { name: /olemasolev Stripe/ })).toHaveCount(0)
  await frame.getByRole('button', { name: 'Seadista maksed', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Stripe test' })).toBeVisible()
  expect(context.pages()).toHaveLength(1)
  await page.getByRole('link', { name: 'Return' }).click()
  await expect(page).toHaveURL(originalUrl)
  frame = page.frameLocator('iframe')
  await expect(frame.getByText('Maksed on valmis', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Telefon', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(flow.counts().starts).toBe(1)
  expect(flow.counts().statuses).toBeGreaterThan(0)
})

test('expired Stripe link is renewed for the same account and early return stays incomplete', async ({ page }) => {
  const frame = await open(page)
  await frame.getByRole('button', { name: 'Jätka maksetega' }).click()
  const flow = await hostedFlow(page, false, true)
  const originalUrl = page.url()
  await frame.getByRole('button', { name: 'Seadista maksed', exact: true }).click()
  await page.getByRole('link', { name: 'Return' }).click()
  await expect(page.getByRole('link', { name: 'Return' })).toHaveAttribute('href', 'http://127.0.0.1:4188/stripe/connect/return')
  await page.getByRole('link', { name: 'Return' }).click()
  await expect(page).toHaveURL(originalUrl)
  await expect(frame.getByRole('button', { name: 'Jätka maksete seadistamist' })).toBeVisible()
  await expect(frame.getByText('Maksed on valmis')).toHaveCount(0)
  expect(flow.counts().starts).toBe(1)
  expect(flow.counts().refreshes).toBe(1)
})

test('failed return status can be retried without creating another account', async ({ page }) => {
  const frame = await open(page)
  await frame.getByRole('button', { name: 'Jätka maksetega' }).click()
  const flow = await hostedFlow(page, true)
  const originalUrl = page.url()
  await frame.getByRole('button', { name: 'Seadista maksed', exact: true }).click()
  flow.setFailStatus(true)
  await page.getByRole('link', { name: 'Return' }).click()
  await expect(page.getByRole('alert')).toContainText('Maksete olekut ei saanud kontrollida.')
  flow.setFailStatus(false)
  await page.getByRole('button', { name: 'Proovi uuesti' }).click()
  await expect(page).toHaveURL(originalUrl)
  await expect(frame.getByText('Maksed on valmis', { exact: true })).toBeVisible()
  expect(flow.counts().starts).toBe(1)
})

test('return without a saved shop never creates a Stripe account', async ({ page }) => {
  let requests = 0
  await page.route('**/functions/v1/stripe-connect', route => { requests++; return route.abort() })
  await page.goto('/stripe/connect/return?refresh=1')
  await expect(page.getByRole('alert')).toContainText('Ava maksete seadistus oma poest uuesti.')
  expect(requests).toBe(0)
})


test('entrepreneur explicitly declares payout account use before continuing and the declaration persists', async ({ page, request }) => {
  const frame = await open(page)
  const declaration = frame.getByRole('checkbox', { name: 'Kinnitan, et kasutan enda aktiivset LHV ettevõtluskontot', exact: false })
  await declaration.uncheck()
  await frame.getByRole('button', { name: 'Jätka maksetega' }).click()
  await expect(frame.getByRole('heading', { name: 'Müüja andmed' })).toBeVisible()
  await expect(declaration).not.toBeChecked()
  await declaration.check()
  await frame.getByRole('button', { name: 'Jätka maksetega' }).click()
  await expect(frame.getByRole('button', { name: 'Seadista maksed', exact: false })).toBeVisible()
  const sessionId = new URL(page.url()).searchParams.get('session')
  const data = await (await request.get(`/__preview/sessions/${sessionId}/data`)).json()
  expect(data.store.settings.entrepreneurPayoutConfirmed).toBe(true)
  await page.getByRole('button', { name: 'Müüja seaded', exact: true }).click()
  await expect(declaration).toBeChecked()
})
