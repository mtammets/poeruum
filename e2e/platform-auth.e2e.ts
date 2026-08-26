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

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const installSupabaseBackend = async (page: Page) => {
  let passwordSignIns = 0
  let sessionRefreshes = 0

  await page.route('**/__e2e_supabase/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

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
      const isOwnedStoreRequest = url.searchParams.get('owner_id') === `eq.${USER_ID}`
      if (isOwnedStoreRequest) await json(route, [store])
      else await json(route, [])
      return
    }

    if (url.pathname.endsWith('/rest/v1/products')) {
      await json(route, [])
      return
    }

    if (url.pathname.endsWith('/functions/v1/stripe-connect')) {
      await json(route, {
        status: 'connected',
        chargesEnabled: true,
        payoutsEnabled: true,
        requirements: {
          dueCount: 1,
          pastDue: false,
          currentDeadline: '2026-10-09T00:00:00.000Z',
          pendingVerification: false,
          disabledReason: null,
        },
      })
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

test('Stripe requirements email link survives login and opens the owned store payment settings', async ({ page }) => {
  const backend = await installSupabaseBackend(page)

  await page.goto('/?stripe_requirements=1')

  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
  await expect(page.getByText('Logi sisse, et Stripe’i andmeid täiendada.')).toBeVisible()
  await expect(page).toHaveURL(/stripe_requirements=1/)

  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool').fill('turvaline-testiparool')
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

test('Stripe requirements email link opens payment settings when PlatformApp restores an existing session', async ({ page }) => {
  const backend = await installSupabaseBackend(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool').fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()

  await page.goto('/?stripe_requirements=1')

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
