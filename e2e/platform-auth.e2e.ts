import { expect, test, type Page, type Route } from '@playwright/test'

const USER_ID = '20000000-0000-4000-8000-000000000001'
const STORE_ID = '10000000-0000-4000-8000-000000000001'

const encodeJwtPart = (value: Record<string, unknown>) => Buffer
  .from(JSON.stringify(value))
  .toString('base64url')

const accessToken = [
  encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
  encodeJwtPart({
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: USER_ID,
    email: 'kaupmees@example.com',
    role: 'authenticated',
  }),
  'playwright-signature',
].join('.')

const user = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'kaupmees@example.com',
  email_confirmed_at: '2026-08-01T08:00:00.000Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-08-01T08:00:00.000Z',
  updated_at: '2026-08-01T08:00:00.000Z',
}

const store = {
  id: STORE_ID,
  owner_id: USER_ID,
  name: 'Sisselogimise testipood',
  slug: 'sisselogimise-testipood',
  is_published: true,
  payment_provider: 'stripe',
  payment_status: 'connected',
  stripe_account_id: 'acct_playwright',
  stripe_account_charges_enabled: true,
  stripe_account_payouts_enabled: true,
  stripe_account_requirements_due_count: 1,
  stripe_account_requirements_past_due: false,
  stripe_account_requirements_deadline: '2026-10-09T00:00:00.000Z',
  stripe_account_requirements_pending_verification: false,
  stripe_account_requirements_disabled_reason: null,
  stripe_account_requirement_issues: [],
  stripe_account_requirements_updated_at: '2026-08-26T06:00:00.000Z',
  stripe_customer_id: null,
  stripe_subscription_id: null,
  stripe_subscription_status: null,
  pricing_plan: 'flexible',
  trial_started_at: null,
  billing_delinquent_at: null,
  billing_grace_ends_at: null,
  billing_last_failed_invoice_id: null,
  billing_last_failed_invoice_url: null,
  billing_downgraded_at: null,
  shipping: ['omniva'],
  settings: {
    onboardingStep: 'complete',
    editableStoreName: 'Sisselogimise testipood',
    businessName: 'Testikaupmees OÜ',
    registryCode: '12345678',
    businessAddress: 'Testi 1, Tallinn',
    contactEmail: 'kaupmees@example.com',
  },
}

const connectedStripeStatus = {
  status: 'connected',
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  requirements: {
    dueCount: 1,
    pastDue: false,
    currentDeadline: '2026-10-09T00:00:00.000Z',
    pendingVerification: false,
    disabledReason: null,
    issues: [],
  },
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  headers: { 'Access-Control-Allow-Origin': '*' },
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const installSupabaseBackend = async (
  page: Page,
  storeFixture: Record<string, unknown> = store,
  stripeStatusFixture: Record<string, unknown> = connectedStripeStatus,
  options: { beforeProductsResponse?: () => Promise<void>; publicStore?: typeof store;
    products?: Record<string, unknown>[]; getOrders?: () => Record<string, unknown>[]; refundOrder?: () => Record<string, unknown> } = {},
) => {
  let passwordSignIns = 0
  let sessionRefreshes = 0
  let currentStore = { ...storeFixture }

  await page.route('**/storage/v1/object/public/product-images/auth-preview.svg', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#226748"/></svg>' }))

  await page.route('**/__e2e_supabase/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      } })
      return
    }

    if (url.pathname.endsWith('/rest/v1/rpc/resolve_store_slug_for_hostname')) {
      await json(route, options.publicStore?.slug ?? null)
      return
    }

    if (url.pathname.endsWith('/rest/v1/public_storefronts')) {
      await json(route, url.searchParams.get('slug') === `eq.${options.publicStore?.slug}` ? options.publicStore : null)
      return
    }

    if (url.pathname.endsWith('/auth/v1/token')) {
      const grantType = url.searchParams.get('grant_type')
      if (grantType === 'password') passwordSignIns += 1
      else if (grantType === 'refresh_token') sessionRefreshes += 1
      else {
        await json(route, { message: 'Unsupported test grant type' }, 400)
        return
      }
      await json(route, {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'playwright-refresh-token',
        user,
      })
      return
    }

    if (url.pathname.endsWith('/auth/v1/user')) {
      await json(route, user)
      return
    }

    if (url.pathname.endsWith('/rest/v1/stores')) {
      if (request.method() === 'PATCH') {
        currentStore = { ...currentStore, ...request.postDataJSON() as Record<string, unknown> }
        await json(route, currentStore)
        return
      }
      const isOwnedStoreRequest = url.searchParams.get('owner_id') === `eq.${USER_ID}`
      if (isOwnedStoreRequest) await json(route, [currentStore])
      else await json(route, [])
      return
    }

    if (url.pathname.endsWith('/rest/v1/products')) {
      if (options.publicStore && url.searchParams.get('store_id') === `eq.${options.publicStore.id}`) {
        await json(route, [{
          id: '30000000-0000-4000-8000-000000000001', store_id: options.publicStore.id,
          name: 'Teise poe toode', slug: 'teise-poe-toode', price: 19, stock: 3, search_visible: true,
          image_url: 'http://localhost:4174/storage/v1/object/public/product-images/auth-preview.svg',
        }])
        return
      }
      await options.beforeProductsResponse?.()
      await json(route, options.products ?? [])
      return
    }

    if (url.pathname.endsWith('/functions/v1/stripe-connect')) {
      await json(route, stripeStatusFixture)
      return
    }

    if (url.pathname.endsWith('/rest/v1/orders')) {
      await json(route, options.getOrders?.() ?? [])
      return
    }
    if (url.pathname.endsWith('/functions/v1/stripe-refund-order')) {
      await json(route, options.refundOrder?.() ?? { error: 'Unexpected test refund' })
      return
    }

    if (url.pathname.includes('/rest/v1/rpc/')) {
      await json(route, null)
      return
    }

    if (url.pathname.endsWith('/rest/v1/platform_settings')) {
      await json(route, null)
      return
    }

    await json(route, [])
  })

  return {
    passwordSignIns: () => passwordSignIns,
    sessionRefreshes: () => sessionRefreshes,
  }
}

const otherStore = {
  ...store,
  id: '10000000-0000-4000-8000-000000000002',
  owner_id: '20000000-0000-4000-8000-000000000002',
  name: 'Krük-Krük',
  slug: 'kruk-kruk',
  settings: { ...store.settings, editableStoreName: 'Krük-Krük', businessName: 'Teine kaupmees OÜ' },
}

test('an unfulfilled order stays refunding until the server confirms the refund', async ({ page }) => {
  const order = {
    order_number: 'PR-REFUND-TEST', items: [], customer_name: 'Testostja', customer_email: 'test@example.invalid',
    delivery: 'Tulen ise järele', product_subtotal: 27.32, total: 27.32, created_at: new Date().toISOString(),
    status: 'new', payment_status: 'paid', stripe_refund_status: null as string | null,
  }
  let refundRequests = 0
  await installSupabaseBackend(page, store, connectedStripeStatus, {
    products: [{ id: 'test-product', store_id: STORE_ID, name: 'Testtoode', slug: 'testtoode', price: 27.32,
      stock: 2, image_url: 'http://localhost:4174/storage/v1/object/public/product-images/auth-preview.svg' }],
    getOrders: () => [order],
    refundOrder: () => { refundRequests += 1; order.stripe_refund_status = 'pending'; return { refunded: false, pending: true } },
  })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await page.getByRole('button', { name: /Tellimused/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Tellimused' })
  await expect(dialog.getByRole('button', { name: 'Märgi täidetuks' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Tagasta makse' }).click()
  await expect(dialog.getByText('Tagastamisel', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Makse tagastatud', { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Tagasta makse' })).toHaveCount(0)
  order.status = 'refunded'
  order.payment_status = 'refunded'
  order.stripe_refund_status = 'succeeded'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(dialog.getByText('Makse tagastatud', { exact: true })).toBeVisible()
  expect(refundRequests).toBe(1)
})

for (const storefrontUrl of ['http://kruk-kruk.poeruum.localhost:4174/', '/p/kruk-kruk/']) {
  test(`merchant login leaves the visited store URL: ${storefrontUrl}`, async ({ page }) => {
    const backend = await installSupabaseBackend(page, store, connectedStripeStatus, { publicStore: otherStore })
    await page.goto(storefrontUrl)
    await expect(page.getByRole('heading', { name: 'Teise poe toode', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Poe omanikule: ava poe halduse sisselogimine' }).click()
    await expect(page).toHaveURL('http://poeruum.localhost:4174/?continue_setup=1')
    await expect(page.getByRole('dialog', { name: 'Logi sisse' })).toHaveCount(0)
    await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
    await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
    await page.getByRole('button', { name: /Jätka oma poega/ }).click()
    await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
    await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
    await expect(page.getByRole('button', { name: store.name, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Teise poe toode', exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
    await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
    expect(backend.passwordSignIns()).toBe(1)
  })
}

test('a public store keeps its own content when another merchant is already signed in', async ({ page }) => {
  const backend = await installSupabaseBackend(page, store, connectedStripeStatus, { publicStore: otherStore })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await page.goto('/p/kruk-kruk/')
  await expect(page.getByRole('heading', { name: 'Teise poe toode', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Seaded/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Poe omanikule: ava poe halduse sisselogimine' }).click()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
  expect(backend.passwordSignIns()).toBe(1)
})

test('legacy storefront owner-login links open the platform login', async ({ page }) => {
  await installSupabaseBackend(page, store, connectedStripeStatus, { publicStore: otherStore })
  await page.goto('http://kruk-kruk.poeruum.localhost:4174/?owner_login=1')
  await expect(page).toHaveURL('http://poeruum.localhost:4174/?continue_setup=1')
  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Logi sisse' })).toHaveCount(0)
})

test('existing merchant never sees new-store onboarding while their store loads', async ({ page }) => {
  let releaseProducts = () => undefined
  const productsBlocked = new Promise<void>((resolve) => { releaseProducts = resolve })
  await installSupabaseBackend(page, store, connectedStripeStatus, {
    beforeProductsResponse: () => productsBlocked,
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()

  await expect(page.getByLabel('Laadin sinu poodi')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mis on sinu poe nimi?' })).toHaveCount(0)

  releaseProducts()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mis on sinu poe nimi?' })).toHaveCount(0)
})

test('merchant logout returns to the Poeruum homepage', async ({ page }) => {
  await installSupabaseBackend(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()

  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await page.getByRole('button', { name: 'Seaded', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Seaded' })
  await settings.getByRole('button', { name: /Konto/ }).click()
  await settings.getByRole('button', { name: 'Logi välja', exact: true }).click()

  await expect(page.getByRole('heading', { name: /Sinu e-pood/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Logi sisse' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tagasi poe muutmisvaatesse' })).toHaveCount(0)
  await expect(page).toHaveURL('http://poeruum.localhost:4174/')
  await page.goto('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
  await expect(page).toHaveURL('http://poeruum.localhost:4174/?continue_setup=1')
})

test('a saved login migrates to the owner address and cannot reopen another shop management', async ({ page }) => {
  const backend = await installSupabaseBackend(page, store, connectedStripeStatus, { publicStore: otherStore })
  await page.addInitScript(({ accessToken, user }) => {
    if (location.hostname !== 'poeruum.localhost') return
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify({
      access_token: accessToken,
      refresh_token: 'playwright-refresh-token',
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    }))
  }, { accessToken, user })
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
  await page.goto('http://kruk-kruk.poeruum.localhost:4174/haldus')
  await expect(page.getByRole('button', { name: store.name, exact: true })).toBeVisible()
  await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
  expect(backend.passwordSignIns()).toBe(0)

  await page.getByRole('button', { name: 'Seaded', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Seaded' })
  await settings.getByRole('button', { name: /Konto/ }).click()
  await settings.getByRole('button', { name: 'Logi välja', exact: true }).click()
  await expect(page).toHaveURL('http://poeruum.localhost:4174/')
  // The init script recreates an old origin-local session; logout must win.
  await expect(page.getByRole('button', { name: 'Logi sisse' }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Logi sisse' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Seaded/ })).toHaveCount(0)
})

test('a draft can continue setup while Stripe verifies submitted details', async ({ page }) => {
  const pendingStore = {
    ...store,
    is_published: false,
    payment_status: 'pending',
    stripe_account_charges_enabled: false,
    stripe_account_payouts_enabled: false,
    stripe_account_requirements_due_count: 0,
    stripe_account_requirements_past_due: false,
    stripe_account_requirements_deadline: null,
    stripe_account_requirements_pending_verification: true,
    stripe_account_requirements_disabled_reason: 'requirements.pending_verification',
    stripe_account_requirement_issues: [],
    settings: { ...store.settings, onboardingStep: 'payments' },
  }
  const pendingStripeStatus = {
    status: 'pending',
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: true,
    requirements: {
      dueCount: 0,
      pastDue: false,
      currentDeadline: null,
      pendingVerification: true,
      disabledReason: 'requirements.pending_verification',
      issues: [],
    },
  }
  await installSupabaseBackend(page, pendingStore, pendingStripeStatus)

  await page.goto('/')
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()

  await expect(page.getByRole('heading', { name: 'Poe maksed' })).toBeVisible()
  await expect(page.getByText('Stripe kontrollib andmeid')).toBeVisible()
  await expect(page.getByText(/Kõik vajalik on esitatud/)).toBeVisible()
  await page.getByRole('button', { name: /Jätka tarnega/ }).click()
  await expect(page.getByRole('heading', { name: 'Vali tarneviisid' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Jätka maksete seadistamist/ })).toHaveCount(0)
})

test('Stripe requirements email link survives login and opens the owned store payment settings', async ({ page }) => {
  const backend = await installSupabaseBackend(page)

  await page.goto('/?stripe_requirements=1')

  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
  await expect(page.getByText('Logi sisse, et Stripe’i andmeid täiendada.')).toBeVisible()
  await expect(page).toHaveURL(/stripe_requirements=1/)

  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()

  const settings = page.getByRole('dialog', { name: 'Seaded' })
  await expect(settings).toBeVisible()
  await expect(settings.getByRole('heading', { name: 'Maksed' })).toBeVisible()
  await expect(settings.locator('.payments-panel')).toBeVisible()
  await expect(settings.getByText('Maksete jätkamiseks kinnita ettevõtte andmed')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Ettevõtte andmete kinnitamine' })).toBeVisible()
  await expect(page.getByText('Ettevõtte andmete kinnitamine on avatud maksete vaates.')).toHaveCount(0)
  await expect(page).not.toHaveURL(/stripe_requirements=/)
  expect(backend.passwordSignIns()).toBe(1)
})

test('Stripe return on the shop hostname opens payment settings with the existing session', async ({ page }) => {
  const backend = await installSupabaseBackend(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()

  await page.goto('http://sisselogimise-testipood.poeruum.localhost:4174/?stripe_requirements=1')

  const settings = page.getByRole('dialog', { name: 'Seaded' })
  await expect(settings).toBeVisible()
  await expect(settings.getByRole('heading', { name: 'Maksed' })).toBeVisible()
  await expect(settings.locator('.payments-panel')).toBeVisible()
  await expect(settings.getByText('Maksete jätkamiseks kinnita ettevõtte andmed')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Ettevõtte andmete kinnitamine' })).toBeVisible()
  await expect(page.getByText('Ettevõtte andmete kinnitamine on avatud maksete vaates.')).toHaveCount(0)
  await expect(page).not.toHaveURL(/stripe_requirements=/)
  expect(backend.passwordSignIns()).toBe(1)
  expect(backend.sessionRefreshes()).toBeGreaterThanOrEqual(1)
})

const receiptToken = 'a'.repeat(64)
const receiptFixture = {
  status: 'paid', orderNumber: 'PR-RECEIPT-TEST', storeName: 'Kruusipood', createdAt: '2026-09-09T12:00:00Z',
  currency: 'eur', total: 27.32, deliveryTotal: 3.32, delivery: 'Omniva · Tallinn · Testi pakiautomaat',
  items: [{ name: 'Sinine kruus', quantity: 2, unitPrice: 12, options: { Värv: 'Sinine' } }], resumeUrl: null,
}
const receiptPath = `/p/kruusipood?checkout=status#receipt=${receiptToken}`

async function receiptBackend(page: Page, response: () => { body: unknown; status?: number }) {
  const requests: unknown[] = []
  await page.route('**/__e2e_supabase/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' } })
      return
    }
    if (route.request().url().endsWith('/functions/v1/order-receipt')) {
      requests.push(route.request().postDataJSON())
      const result = response()
      await json(route, result.body, result.status)
    } else await json(route, [])
  })
  return requests
}

test('receipt persists after reload, uses the server status and works without a published storefront', async ({ page }) => {
  const requests = await receiptBackend(page, () => ({ body: { receipt: receiptFixture } }))
  await page.goto(receiptPath)
  await expect(page.getByRole('heading', { name: 'Makse õnnestus' })).toBeVisible()
  await expect(page.getByText('PR-RECEIPT-TEST')).toBeVisible()
  await expect(page.getByText('Omniva · Tallinn · Testi pakiautomaat')).toBeVisible()
  await expect(page.getByText('Sinine kruus')).toBeVisible()
  await expect(page.locator('.order-receipt__total')).toContainText('27,32')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Makse õnnestus' })).toBeVisible()
  await expect(page.getByText('PR-RECEIPT-TEST')).toBeVisible()
  expect(requests.length).toBeGreaterThanOrEqual(2)
  expect(requests.every((body) => JSON.stringify(body) === JSON.stringify({ token: receiptToken }))).toBe(true)
  expect(new URL(page.url()).search).not.toContain(receiptToken)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByRole('link', { name: 'Tagasi poodi' })).toHaveAttribute('href', '/p/kruusipood')
})

test('success URL cannot manufacture a confirmation and a damaged token reveals no order', async ({ page }) => {
  const requests = await receiptBackend(page, () => ({ status: 404, body: { error: 'Selle lingiga tellimust ei leitud.' } }))
  await page.goto('/p/kruusipood?checkout=success')
  await expect(page.getByRole('heading', { name: 'Tellimuse olek pole teada' })).toBeVisible()
  expect(requests).toHaveLength(0)
  await expect(page.getByText('Makse õnnestus', { exact: true })).toHaveCount(0)
  await page.goto(receiptPath)
  await expect(page.getByRole('alert')).toHaveText('Selle lingiga tellimust ei leitud.')
  await expect(page.getByText('PR-RECEIPT-TEST')).toHaveCount(0)
})

test('pending receipt polls to confirmed payment without depending on email delivery', async ({ page }) => {
  let paid = false
  await receiptBackend(page, () => ({ body: { receipt: { ...receiptFixture, status: paid ? 'paid' : 'pending' } } }))
  await page.goto(receiptPath)
  await expect(page.getByRole('heading', { name: 'Kontrollime makset' })).toBeVisible()
  await expect(page.getByText(/Ära tee uut makset/)).toBeVisible()
  paid = true
  await expect(page.getByRole('heading', { name: 'Makse õnnestus' })).toBeVisible({ timeout: 10000 })
})

test('temporary network failure stays unknown and explicit retry recovers', async ({ page }) => {
  let failed = true
  await receiptBackend(page, () => failed ? { status: 503, body: { error: 'Ajutine ühenduse tõrge.' } } : { body: { receipt: receiptFixture } })
  await page.goto(receiptPath)
  await expect(page.getByRole('alert')).toHaveText('Ajutine ühenduse tõrge.')
  await expect(page.getByRole('heading', { name: 'Tellimuse olek pole teada' })).toBeVisible()
  await expect(page.getByText('Makse ebaõnnestus', { exact: true })).toHaveCount(0)
  failed = false
  await page.getByRole('button', { name: 'Kontrolli olekut uuesti' }).click()
  await expect(page.getByRole('heading', { name: 'Makse õnnestus' })).toBeVisible()
})

test('legacy checkout returns use their session credential and do not trust the cancelled flag', async ({ page }) => {
  const requests = await receiptBackend(page, () => ({ body: { receipt: receiptFixture } }))
  const sessionId = 'cs_test_' + 'b'.repeat(40)
  await page.goto(`/p/kruusipood?checkout=cancelled&session_id=${sessionId}`)
  await expect(page.getByRole('heading', { name: 'Makse õnnestus' })).toBeVisible()
  expect(requests).toContainEqual({ sessionId })
  expect(new URL(page.url()).search).not.toContain(sessionId)
  expect(new URL(page.url()).hash).toContain(sessionId)
})

test('mobile failed, expired and refunded receipts show the actual state; retry reuses the existing checkout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let status = 'failed'
  const resumeUrl = 'https://checkout.stripe.com/c/pay/existing-session'
  await receiptBackend(page, () => ({ body: { receipt: { ...receiptFixture, status, resumeUrl: status === 'failed' ? resumeUrl : null } } }))
  await page.goto(receiptPath)
  await expect(page.getByRole('heading', { name: 'Makse ebaõnnestus' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Jätka maksmist' })).toHaveAttribute('href', resumeUrl)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  status = 'expired'
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Makseleht on aegunud' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Jätka maksmist' })).toHaveCount(0)
  status = 'refunded'
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Makse on tagastatud' })).toBeVisible()
})

test('checkout explains Link and opens a payment page only after the customer continues', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let checkoutRequests = 0
  await receiptBackend(page, () => ({ body: { receipt: { ...receiptFixture, status: 'unpaid' } } }))
  // Register checkout after the general backend so Playwright selects it first.
  await page.route('**/__e2e_supabase/functions/v1/stripe-store-checkout', async (route) => {
    checkoutRequests++
    await json(route, { url: `http://poeruum.localhost:4174${receiptPath}` })
  })
  await page.goto('/?checkout=status')
  await expect(page.getByRole('heading', { name: 'Tellimuse olek pole teada' })).toBeVisible()
  await page.evaluate(async () => {
    const { mountCheckoutHarness } = await import('/e2e/checkout-harness.tsx')
    mountCheckoutHarness()
  })
  await expect(page.getByText(/Link võib kasutada sinu varem salvestatud makseandmeid/)).toBeVisible()
  await page.getByRole('textbox', { name: 'Nimi', exact: true }).fill('Test Ostja')
  await page.getByRole('textbox', { name: 'E-post', exact: true }).fill('ostja@example.invalid')
  await page.getByRole('textbox', { name: 'Telefon', exact: true }).fill('+37255555555')
  expect(checkoutRequests).toBe(0)
  await page.getByRole('button', { name: 'Edasi maksma · 27,32 €' }).click()
  await expect(page.getByRole('heading', { name: 'Makse on lõpetamata' })).toBeVisible()
  expect(checkoutRequests).toBe(1)
})

test('checkout retries keep their attempt after errors and reloads, and change it for a different purchase', async ({ page }) => {
  const attempts: Array<{ checkoutRequestId: string }> = []
  await receiptBackend(page, () => ({ body: { receipt: receiptFixture } }))
  await page.route('**/__e2e_supabase/functions/v1/stripe-store-checkout', async (route) => {
    attempts.push(route.request().postDataJSON())
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Ajutine ühenduse tõrge.' }) })
  })
  const mount = async () => {
    await page.evaluate(async () => {
      const { mountCheckoutHarness } = await import('/e2e/checkout-harness.tsx')
      mountCheckoutHarness()
    })
    await page.getByRole('textbox', { name: 'Nimi', exact: true }).fill('Test Ostja')
    await page.getByRole('textbox', { name: 'E-post', exact: true }).fill('ostja@example.invalid')
    await page.getByRole('textbox', { name: 'Telefon', exact: true }).fill('+37255555555')
  }
  const submit = async () => {
    await page.getByRole('button', { name: 'Edasi maksma · 27,32 €' }).click()
    await expect(page.getByRole('button', { name: 'Edasi maksma · 27,32 €' })).toBeEnabled()
    await expect(page.getByText('Ajutine ühenduse tõrge.', { exact: true })).toBeVisible()
  }
  await page.goto('/?checkout=status')
  await mount(); await submit(); await submit()
  await page.reload(); await mount(); await submit()
  expect(attempts).toHaveLength(3)
  expect(new Set(attempts.map((attempt) => attempt.checkoutRequestId)).size).toBe(1)
  const storage = await page.evaluate(() => sessionStorage.getItem('poeruum-checkout-attempt-v1'))
  expect(storage).not.toContain('ostja@example.invalid')
  await page.getByRole('textbox', { name: 'E-post', exact: true }).fill('teine@example.invalid')
  await submit()
  expect(attempts[3].checkoutRequestId).not.toBe(attempts[0].checkoutRequestId)
})

test('a terminal receipt clears the completed attempt and explains starting again', async ({ page }) => {
  await receiptBackend(page, () => ({ body: { receipt: { ...receiptFixture, status: 'failed', resumeUrl: null } } }))
  await page.goto('/?checkout=status')
  await page.evaluate(() => sessionStorage.setItem('poeruum-checkout-attempt-v1', JSON.stringify({ fingerprint: 'test', requestId: 'old' })))
  await page.goto(receiptPath)
  await expect(page.getByRole('heading', { name: 'Makse ebaõnnestus' })).toBeVisible()
  await expect(page.getByText('Selle tellimuse eest pole kinnitatud makset. Uue tellimuse saad vormistada poes.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Jätka maksmist' })).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('poeruum-checkout-attempt-v1'))).toBeNull()
})
