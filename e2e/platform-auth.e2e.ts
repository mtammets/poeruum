import { expect, test, type Page, type Route } from '@playwright/test'

const USER_ID = '20000000-0000-4000-8000-000000000001'
const STORE_ID = '10000000-0000-4000-8000-000000000001'

test('homepage loads responsive showcase images in parallel and waits for the next slide', async ({ page }) => {
  await installSupabaseBackend(page)
  await page.clock.install()
  const showcaseId = '00000000-0000-4000-8000-000000000001'
  const imageRoot = 'http://localhost:4174/storage/v1/object/public/product-images/showcase-test'
  const products = ['lamp', 'vase', 'tray'].map((name, index) => {
    const image = `${imageRoot}/${name}/master.svg`
    const variant = (role: string, width: number, height: number) => ({ url: `${imageRoot}/${name}/${role}.svg`, width, height, bytes: width })
    return {
      id: name, store_id: showcaseId, name, image_url: image, gallery: [image], price: 39,
      search_visible: true, sort_order: index,
      image_variants: { [image]: { mimeType: 'image/svg+xml', variants: {
        thumb: variant('thumb', 320, 480), medium: variant('medium', 640, 960),
        large: variant('master', 1024, 1536), master: variant('master', 1024, 1536),
      } } },
    }
  })
  let releaseStore!: () => void
  let releaseNextImage!: () => void
  const storeReady = new Promise<void>((resolve) => { releaseStore = resolve })
  const nextImageReady = new Promise<void>((resolve) => { releaseNextImage = resolve })
  let storeRequests = 0
  let productRequests = 0
  const requestedImages: string[] = []
  await page.route('**/rest/v1/public_storefronts?*', async (route) => {
    storeRequests += 1
    await storeReady
    await json(route, { ...store, id: showcaseId, slug: 'naidispood' })
  })
  await page.route('**/rest/v1/products?*', async (route) => {
    productRequests += 1
    await json(route, products)
  })
  await page.route(`${imageRoot}/**`, async (route) => {
    requestedImages.push(route.request().url())
    if (route.request().url().includes('/vase/')) await nextImageReady
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="320" height="480" fill="#265f43"/></svg>' })
  })

  try {
    await page.goto('/')
    // Products must be requested even while the store response is still held.
    await expect.poll(() => productRequests).toBe(1)
    releaseStore()
    const slides = page.locator('.platform-phone__slides')
    const firstImage = slides.locator('img').nth(1)
    await expect(firstImage).toHaveAttribute('fetchpriority', 'high')
    await expect.poll(() => firstImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    expect(await firstImage.evaluate((image: HTMLImageElement) => image.currentSrc)).toContain('/lamp/thumb.svg')
    expect(requestedImages.some((url) => url.endsWith('/master.svg'))).toBe(false)
    expect(storeRequests).toBe(1)
    expect(productRequests).toBe(1)

    await page.clock.runFor(3500)
    await expect(slides).toHaveAttribute('style', 'transform: translateX(-100%);')
    releaseNextImage()
    await expect.poll(() => slides.locator('img').nth(2).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await page.clock.runFor(3300)
    await expect(slides).toHaveAttribute('style', 'transform: translateX(-200%);')
  } finally {
    releaseStore()
    releaseNextImage()
  }
})

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
  let currentPassword: string | null = null
  const passwordUpdates: string[] = []
  const passwordResetRedirects: string[] = []
  const signOutScopes: string[] = []
  let currentStore = { ...storeFixture }
  let currentProducts = structuredClone(options.products ?? [])

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
      if (grantType === 'password') {
        passwordSignIns += 1
        if (currentPassword && request.postDataJSON().password !== currentPassword) {
          await json(route, { code: 'invalid_credentials', message: 'Invalid login credentials' }, 400)
          return
        }
      }
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
      if (request.method() === 'PUT') {
        currentPassword = request.postDataJSON().password
        passwordUpdates.push(currentPassword!)
      }
      await json(route, user)
      return
    }

    if (url.pathname.endsWith('/auth/v1/recover')) {
      passwordResetRedirects.push(url.searchParams.get('redirect_to') ?? '')
      await json(route, {})
      return
    }

    if (url.pathname.endsWith('/auth/v1/logout')) {
      signOutScopes.push(url.searchParams.get('scope') ?? '')
      await json(route, {})
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
      if (request.method() === 'POST') {
        const product = request.postDataJSON() as Record<string, unknown>
        currentProducts = [...currentProducts.filter((item) => item.id !== product.id), product]
        await json(route, product)
        return
      }
      if (options.publicStore && url.searchParams.get('store_id') === `eq.${options.publicStore.id}`) {
        await json(route, options.products ? currentProducts : [{
          id: '30000000-0000-4000-8000-000000000001', store_id: options.publicStore.id,
          name: 'Teise poe toode', slug: 'teise-poe-toode', price: 19, stock: 3, search_visible: true,
          image_url: 'http://localhost:4174/storage/v1/object/public/product-images/auth-preview.svg',
        }])
        return
      }
      await options.beforeProductsResponse?.()
      await json(route, currentProducts)
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
    currentStore: () => currentStore,
    currentProducts: () => currentProducts,
    passwordSignIns: () => passwordSignIns,
    sessionRefreshes: () => sessionRefreshes,
    passwordUpdates,
    passwordResetRedirects,
    signOutScopes,
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

const recoveryFragment = new URLSearchParams({
  access_token: accessToken,
  refresh_token: 'playwright-refresh-token',
  expires_in: '3600',
  token_type: 'bearer',
  type: 'recovery',
}).toString()

test('password recovery survives Supabase consuming the link before the login view loads', async ({ page }) => {
  await installSupabaseBackend(page)
  let releaseView!: () => void
  const viewReady = new Promise<void>((resolve) => { releaseView = resolve })
  await page.route('**/src/PlatformApp.tsx', async (route) => {
    await viewReady
    await route.continue()
  })
  try {
    await page.goto(`/#${recoveryFragment}`, { waitUntil: 'commit' })
    // The real SDK processes the recovery session while the lazy view is pending.
    await page.waitForFunction(() => window.location.hash === '')
  } finally {
    releaseView()
  }
  await expect(page.getByRole('heading', { name: 'Vali uus parool', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Seaded/ })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Vali uus parool', exact: true })).toBeVisible()
})

test('password recovery sends a dedicated link, saves the new password and requires a fresh login', async ({ page }) => {
  const backend = await installSupabaseBackend(page)
  await page.goto('/?continue_setup=1')
  await page.getByRole('button', { name: 'Unustasid parooli?' }).click()
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByRole('button', { name: /Saada taastamislink/ }).click()
  await expect(page.getByRole('status')).toHaveText('Taastamislink on saadetud. Kontrolli oma e-posti.')
  expect(backend.passwordResetRedirects).toEqual(['http://poeruum.localhost:4174/?reset_password=1'])

  await page.goto(`${backend.passwordResetRedirects[0]}#${recoveryFragment}`)
  await expect(page.getByText(`Konto: ${user.email}`, { exact: true })).toBeVisible()
  expect(backend.passwordUpdates).toEqual([])
  const newPassword = 'Uus-testiparool-123!'
  await page.getByLabel('Uus parool', { exact: true }).fill(newPassword)
  await page.getByLabel('Korda uut parooli', { exact: true }).fill('Erinev-parool-123!')
  await page.getByRole('button', { name: /Salvesta uus parool/ }).click()
  await expect(page.getByRole('alert')).toHaveText('Paroolid ei ühti.')
  expect(backend.passwordUpdates).toEqual([])
  await page.getByLabel('Korda uut parooli', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: /Salvesta uus parool/ }).click()
  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Parool on muudetud. Logi nüüd uue parooliga sisse.')
  expect(backend.passwordUpdates).toEqual([newPassword])
  expect(backend.signOutScopes).toEqual(['global'])
  await expect(page).toHaveURL('http://poeruum.localhost:4174/')

  await page.getByLabel('Parool', { exact: true }).fill('Vana-testiparool-123!')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByLabel('Parool', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
})

for (const callback of [
  '/?reset_password=1',
  '/?reset_password=1#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
]) {
  test(`password recovery rejects a missing or expired link: ${callback}`, async ({ page }) => {
    const backend = await installSupabaseBackend(page)
    await page.goto(callback)
    await expect(page.getByRole('alert')).toHaveText('Taastamislink on aegunud või vigane. Palun telli uus taastamislink.')
    await expect(page.getByRole('button', { name: /Salvesta uus parool/ })).toBeDisabled()
    expect(backend.passwordUpdates).toEqual([])
    await page.getByRole('button', { name: 'Telli uus taastamislink' }).click()
    await expect(page.getByRole('heading', { name: 'Unustasid parooli?', exact: true })).toBeVisible()
    await page.getByLabel('E-posti aadress').fill(user.email)
    await page.getByRole('button', { name: /Saada taastamislink/ }).click()
    await expect(page.getByRole('status')).toHaveText('Taastamislink on saadetud. Kontrolli oma e-posti.')
    expect(backend.passwordResetRedirects).toEqual(['http://poeruum.localhost:4174/?reset_password=1'])
  })
}

test('password recovery on an old shop link takes priority over the public storefront and can be cancelled', async ({ page }) => {
  const backend = await installSupabaseBackend(page, store, connectedStripeStatus, { publicStore: otherStore })
  await page.goto(`http://kruk-kruk.poeruum.localhost:4174/#${recoveryFragment}`)
  await expect(page.getByRole('button', { name: /Salvesta uus parool/ })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Teise poe toode', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Tagasi eelmisele lehele' }).click()
  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
  expect(backend.passwordUpdates).toEqual([])
  expect(backend.signOutScopes).toEqual(['local'])
  await page.goto('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
  await expect(page).toHaveURL('http://poeruum.localhost:4174/?continue_setup=1')
  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
})

test('password recovery does not accept an expired link just because the browser is already signed in', async ({ page }) => {
  await installSupabaseBackend(page)
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await page.goto('/?reset_password=1#error=access_denied&error_code=otp_expired')
  await expect(page.getByRole('alert')).toHaveText('Taastamislink on aegunud või vigane. Palun telli uus taastamislink.')
  await expect(page.getByRole('button', { name: /Salvesta uus parool/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Telli uus taastamislink' })).toBeVisible()
})

test('password recovery preserves the form when saving the password fails', async ({ page }) => {
  const backend = await installSupabaseBackend(page)
  await page.route('**/__e2e_supabase/auth/v1/user', async (route) => {
    if (route.request().method() === 'PUT') await json(route, { message: 'Parooli salvestamine ebaõnnestus.' }, 500)
    else await route.fallback()
  })
  await page.goto(`/?reset_password=1#${recoveryFragment}`)
  await page.getByLabel('Uus parool', { exact: true }).fill('Uus-testiparool-123!')
  await page.getByLabel('Korda uut parooli', { exact: true }).fill('Uus-testiparool-123!')
  await page.getByRole('button', { name: /Salvesta uus parool/ }).click()
  await expect(page.getByRole('alert')).toHaveText('Parooli muutmine ebaõnnestus.')
  await expect(page.getByRole('heading', { name: 'Vali uus parool', exact: true })).toBeVisible()
  expect(backend.passwordUpdates).toEqual([])
  expect(backend.signOutScopes).toEqual([])
  await page.reload()
  await expect(page.getByRole('button', { name: /Salvesta uus parool/ })).toBeEnabled()
})

test('product description paragraphs survive editing, saving and customer reloads', async ({ page, browser }) => {
  const original = 'Algne esimene lõik.\n\nAlgne teine lõik.\n\nAlgne kolmas lõik.'
  const backend = await installSupabaseBackend(page, store, connectedStripeStatus, {
    products: [{ id: 'paragraph-product', store_id: STORE_ID, name: 'Taldrik', slug: 'taldrik', description: original,
      price: 29, stock: 1, image_url: 'http://localhost:4174/storage/v1/object/public/product-images/auth-preview.svg' }],
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  const description = page.locator('.product-description')
  await expect(description).toHaveCSS('white-space', 'pre-wrap')
  await expect(description).toHaveText(original, { useInnerText: true })
  await page.getByRole('button', { name: 'Muuda toodet', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Toote kirjeldus', exact: true })
  await editor.click()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(original)
  await editor.fill('Esimene lõik.')
  await editor.press('Enter')
  await editor.press('Enter')
  await editor.pressSequentially('Teine lõik.')
  await editor.press('Shift+Enter')
  await editor.pressSequentially('Teise lõigu uus rida.')
  await editor.press('Enter')
  await editor.press('Enter')
  await editor.pressSequentially('Kolmas lõik.')
  const expected = 'Esimene lõik.\n\nTeine lõik.\nTeise lõigu uus rida.\n\nKolmas lõik.'
  await page.getByRole('button', { name: 'Salvesta muudatused', exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect(backend.currentProducts()[0].description).toBe(expected)
  expect(await description.innerText()).toBe(expected)
  await page.reload()
  await expect(description).toHaveText(expected, { useInnerText: true })

  const customer = await browser.newPage({ viewport: { width: 390, height: 844 } })
  try {
    await installSupabaseBackend(customer, store, connectedStripeStatus, { publicStore: store, products: backend.currentProducts() })
    await customer.goto(`http://${store.slug}.poeruum.localhost:4174/toode/taldrik/`)
    const published = customer.locator('.product-description')
    await expect(published).toHaveCSS('white-space', 'pre-wrap')
    expect(await published.innerText()).toBe(expected)
    await customer.reload()
    await expect(published).toHaveText(expected, { useInnerText: true })
  } finally {
    await customer.close()
  }
})

test('a merchant configures a dispatch range without an unconfirmed default promise', async ({ page, browser }) => {
  const deliverySettings = {
    parcelProviders: { omniva: { enabled: true, price: 3 }, dpd: { enabled: false, price: 3 }, smartposti: { enabled: false, price: 3 } },
    courierEnabled: false, courierPrice: 5, pickupEnabled: false, pickupAddress: '', freeShippingFrom: 50,
  }
  const products = [2, null, 0].map((stock, index) => ({
    id: `dispatch-product-${index}`, store_id: STORE_ID, name: `Testtoode ${index}`, slug: `testtoode-${index}`, price: 20,
    stock, image_url: 'http://localhost:4174/storage/v1/object/public/product-images/auth-preview.svg',
  }))
  const backend = await installSupabaseBackend(page, { ...store, settings: { ...store.settings, deliverySettings } }, connectedStripeStatus, { products })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.locator('.product-availability strong')).toHaveText('Laos olemas')
  await expect(page.locator('.product-availability small')).toHaveCount(0)
  await page.getByRole('button', { name: 'Toode 2', exact: true }).click()
  await expect(page.locator('.product-availability')).toHaveCount(0)
  await page.getByRole('button', { name: 'Toode 1', exact: true }).click()
  await page.getByRole('button', { name: /Seaded/ }).click()
  await page.locator('.settings-home button[data-section="delivery"]').click()
  const showDispatchTime = page.getByRole('checkbox', { name: /^Näita väljasaatmise aega/ })
  await expect(showDispatchTime).not.toBeChecked()
  await showDispatchTime.check()
  const range = page.getByRole('group', { name: 'Väljasaatmise ajavahemik' })
  await range.getByLabel('Alates').fill('5')
  await range.getByLabel('Kuni').fill('3')
  await expect(page.getByRole('alert')).toHaveText('Ajavahemiku lõpp ei tohi olla algusest väiksem.')
  await expect(page.getByRole('button', { name: 'Salvesta', exact: true })).toBeDisabled()
  // Wait beyond the settings debounce to verify invalid ranges are not autosaved.
  await page.waitForTimeout(2200)
  expect(backend.currentStore().settings).toEqual({ ...store.settings, deliverySettings })
  await range.getByLabel('Alates').fill('2')
  await range.getByLabel('Ühik').selectOption('weeks')
  await expect(page.getByText('Ostjale kuvatakse: Saadame 2–3 nädalaga')).toBeVisible()
  await page.getByRole('button', { name: 'Salvesta', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Salvestatud', exact: true })).toBeVisible()
  const savedStore = backend.currentStore() as typeof store & { settings: { deliverySettings: typeof deliverySettings & { dispatchTime: { enabled: boolean; min: number; max: number; unit: string } } } }
  expect(savedStore.settings.deliverySettings).toEqual({ ...deliverySettings, dispatchTime: { enabled: true, min: 2, max: 3, unit: 'weeks' } })

  await page.reload()
  await expect(page.locator('.product-availability small')).toHaveText('Saadame 2–3 nädalaga')
  await page.getByRole('button', { name: /Seaded/ }).click()
  await page.locator('.settings-home button[data-section="delivery"]').click()
  await expect(showDispatchTime).toBeChecked()
  await expect(range.getByLabel('Alates')).toHaveValue('2')
  await expect(range.getByLabel('Kuni')).toHaveValue('3')
  await expect(range.getByLabel('Ühik')).toHaveValue('weeks')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const customer = await browser.newPage({ viewport: { width: 390, height: 844 } })
  try {
    await installSupabaseBackend(customer, store, connectedStripeStatus, { publicStore: savedStore, products })
    await customer.goto(`http://${store.slug}.poeruum.localhost:4174/`)
    await expect(customer.locator('.product-availability small')).toHaveText('Saadame 2–3 nädalaga')
    await customer.getByRole('button', { name: 'Toode 2', exact: true }).click()
    await expect(customer.locator('.product-availability small')).toHaveText('Saadame 2–3 nädalaga')
    await expect(customer.locator('.product-availability strong')).toHaveCount(0)
    await customer.getByRole('button', { name: 'Toode 3', exact: true }).click()
    await expect(customer.locator('.product-availability small')).toHaveText('Hetkel pole tellitav')
    expect(await customer.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  } finally {
    await customer.close()
  }

  await showDispatchTime.uncheck()
  await page.getByRole('button', { name: 'Salvesta', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Salvestatud', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('.product-availability strong')).toHaveText('Laos olemas')
  await expect(page.locator('.product-availability small')).toHaveCount(0)
  await page.getByRole('button', { name: /Seaded/ }).click()
  await page.locator('.settings-home button[data-section="delivery"]').click()
  await expect(showDispatchTime).not.toBeChecked()
  await showDispatchTime.check()
  await expect(range.getByLabel('Alates')).toHaveValue('2')
  await expect(range.getByLabel('Kuni')).toHaveValue('3')
})

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
    await page.getByRole('textbox', { name: 'Arve aadress', exact: true }).fill('Testi 1, Tallinn, 10111')
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
    await page.getByRole('textbox', { name: 'Arve aadress', exact: true }).fill('Testi 1, Tallinn, 10111')
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


test('company checkout sends billing details and changes the attempt when the invoice recipient changes', async ({ page }) => {
  const requests: Array<{ checkoutRequestId: string; billing: { company: boolean; name: string; registryCode: string; address: string } }> = []
  await receiptBackend(page, () => ({ body: { receipt: receiptFixture } }))
  await page.route('**/__e2e_supabase/functions/v1/stripe-store-checkout', async (route) => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Ajutine tõrge.' }) })
  })
  await page.goto('/?checkout=status')
  await page.evaluate(async () => {
    const { mountCheckoutHarness } = await import('/e2e/checkout-harness.tsx')
    mountCheckoutHarness()
  })
  await page.getByRole('textbox', { name: 'Nimi', exact: true }).fill('Õie Ostja')
  await page.getByRole('textbox', { name: 'E-post', exact: true }).fill('ostja@example.invalid')
  await page.getByRole('textbox', { name: 'Telefon', exact: true }).fill('+37255555555')
  await page.getByRole('checkbox', { name: 'Ostan ettevõttele' }).check()
  await page.getByRole('textbox', { name: 'Ettevõtte nimi', exact: true }).fill('Ostja OÜ')
  await page.getByRole('textbox', { name: 'Registrikood', exact: true }).fill('12345678')
  await page.getByRole('textbox', { name: 'Arve aadress', exact: true }).fill('Testi 1, Tallinn, 10111')
  await page.getByRole('button', { name: 'Edasi maksma · 27,32 €' }).click()
  await expect(page.getByText('Ajutine tõrge.')).toBeVisible()
  expect(requests[0].billing).toEqual({ company: true, name: 'Ostja OÜ', registryCode: '12345678', vatNumber: '', address: 'Testi 1, Tallinn, 10111' })
  await page.getByRole('textbox', { name: 'Ettevõtte nimi', exact: true }).fill('Teine OÜ')
  await page.getByRole('button', { name: 'Edasi maksma · 27,32 €' }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[1].checkoutRequestId).not.toBe(requests[0].checkoutRequestId)
})

test('private receipt downloads its invoice and credit without exposing a public file URL', async ({ page }) => {
  const invoice = { id: '79000000-0000-4000-8000-000000000003', number: 'TEST-PR1-2026-000001', kind: 'invoice', ready: true }
  const credit = { ...invoice, id: '79000000-0000-4000-8000-000000000004', number: 'TEST-PR1-2026-000002', kind: 'credit' }
  const bodies: Array<{ token: string; documentId?: string }> = []
  await receiptBackend(page, () => ({ body: { receipt: { ...receiptFixture, status: 'refunded', hasInvoice: true } } }))
  await page.route('**/__e2e_supabase/functions/v1/order-documents', async (route) => {
    const body = route.request().postDataJSON()
    bodies.push(body)
    if (body.documentId) await route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.7\n%%EOF' })
    else await json(route, { documents: [invoice, credit] })
  })
  await page.goto(receiptPath)
  await expect(page.getByRole('button', { name: 'Arve TEST-PR1-2026-000001 · PDF', exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Arve TEST-PR1-2026-000001 · PDF', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('Arve-TEST-PR1-2026-000001.pdf')
  await expect(page.getByRole('button', { name: 'Kreeditarve TEST-PR1-2026-000002 · PDF', exact: true })).toBeVisible()
  expect(bodies[0].token).toHaveLength(64)
  expect(bodies[1]).toEqual({ token: bodies[0].token, documentId: invoice.id })
  await expect(page.locator('a[href*="order-documents"]')).toHaveCount(0)
})
