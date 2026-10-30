import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.use({ baseURL: 'http://kruk-kruk.poeruum.localhost:4174' })

async function backend(page: Page, { closed = false, empty = false, slug = 'kruk-kruk', signedIn = false, failSave = false } = {}) {
  const user = { id: '20000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'owner@example.invalid', app_metadata: {}, user_metadata: {} }
  if (signedIn) await page.addInitScript(user => {
    const access_token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify({ access_token, refresh_token: 'test-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user }))
  }, user)
  let writes = 0
  const productImage = 'http://localhost:4174/storage/v1/object/public/product-images/hat.webp'
  await page.route(productImage, async route => route.fulfill({ contentType: 'image/webp', body: await readFile('public/images/campaigns/kruk-cap-forest-model-v1.webp') }))
  const store = {
    id: '10000000-0000-4000-8000-000000000001', name: 'Krük-Krük', slug, is_published: true,
    payment_provider: 'stripe', payment_status: 'connected', shipping: ['omniva'],
    settings: {
      storeTheme: 'paper', storeAccent: '#bdcb20', autoSwipeEnabled: false,
      directoryCover: '/images/campaigns/kruk-cap-forest-model-v1.webp',
      storeDescription: 'Loodusest inspireeritud Eesti disain.', businessName: 'Krük-Krük OÜ',
      contactEmail: 'hello@example.invalid', contactPhone: '+372 5550 0000', registryCode: '12345678',
      businessAddress: 'Kuusalu', sellerType: 'company',
      companyHomepage: {} as Record<string, string>,
    },
  }
  await page.route('**/__e2e_supabase/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = []
    if (path.endsWith('/user')) data = user
    if (path.endsWith('/stores')) {
      expect(new URL(route.request().url()).searchParams.get('owner_id')).toBe(`eq.${user.id}`)
      data = signedIn ? { ...store, owner_id: user.id, updated_at: '2026-10-30T12:00:00Z', settings: { ...store.settings, orderNotificationEmail: 'private@example.invalid' } } : null
      if (route.request().method() === 'PATCH') {
        writes += 1
        if (failSave) return route.fulfill({ status: 500, json: { message: 'Test save failure' } })
        const body = route.request().postDataJSON()
        expect(body.settings.orderNotificationEmail).toBe('private@example.invalid')
        expect(new URL(route.request().url()).searchParams.get('updated_at')).toBe('eq.2026-10-30T12:00:00Z')
        store.settings.companyHomepage = body.settings.companyHomepage
        data = { id: store.id }
      }
    }
    if (path.endsWith('/public_storefronts')) data = closed ? null : store
    if (path.endsWith('/rpc/closed_storefront_branding')) data = closed ? { name: store.name, theme: 'paper', accent: '#bdcb20' } : null
    if (path.endsWith('/products')) data = empty ? [] : [{
      id: 'hat', store_id: store.id, slug: 'nokkmuts', name: 'Nokkmüts „2rähn“',
      description: 'Kaks rähni sümboliseerivad inimese hinge duaalsust.',
      image_url: productImage, price: 24.42, sale_price: 19.9,
      stock: 24, search_visible: true, options: [],
    }]
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    } })
  })
  return { writes: () => writes, allowSaving: () => { failSave = false } }
}

test('company page tells Madis’s story, links to product and returns from the shop', async ({ page }) => {
  await backend(page)
  await page.goto('/koduleht/')
  await expect(page.getByRole('heading', { name: 'Töö mingu metsa.', level: 1 })).toBeVisible()
  await expect(page).toHaveTitle('Krük-Krük — lugu ja looming')
  await expect(page.locator('.company-about__copy')).toContainText('Olen Kuusalust pärit tavaline mees.')
  await expect(page.locator('.company-about__copy')).toContainText('Nimi tuli rähni häälest.')
  await expect(page.locator('.company-feature__story')).toContainText('kahe rähni märk')
  await expect(page.locator('.company-feature__price')).toContainText('19,90')
  await expect(page.getByRole('link', { name: 'hello@example.invalid' })).toHaveAttribute('href', 'mailto:hello@example.invalid')
  await expect(page.getByRole('link', { name: '+372 5550 0000' })).toHaveAttribute('href', 'tel:+37255500000')
  await page.getByRole('link', { name: 'Vaata toodet e-poes' }).click()
  await expect(page).toHaveURL(/\/toode\/nokkmuts\/$/)
  await expect(page.locator('.product-details h1')).toHaveText('Nokkmüts „2rähn“')
  await page.locator('.store-homepage-link').click()
  await expect(page).toHaveURL(/\/koduleht\/$/)
  await expect(page.locator('.company-hero')).toBeVisible()
  await page.reload()
  await expect(page.locator('.company-hero')).toBeVisible()
})

test('phone and desktop layouts scroll to company information without horizontal overflow', async ({ page }) => {
  await backend(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/koduleht/')
    await expect(page.locator('.company-hero')).toBeVisible()
    await expect(page.getByRole('link', { name: 'E-poodi', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('navigation', { name: 'Kodulehe menüü' }).getByRole('link', { name: 'Lugu', exact: true }).click()
    await expect(page).toHaveURL(/#meist$/)
    await expect(page.getByRole('heading', { name: 'Loodusest nokk ees.', level: 2 })).toBeInViewport()
    await page.getByRole('heading', { name: 'Võta ühendust.' }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('path-based preview keeps links within the selected shop', async ({ page }) => {
  await backend(page)
  await page.goto('http://poeruum.localhost:4174/p/kruk-kruk/koduleht/')
  await expect(page.getByRole('link', { name: 'E-poodi', exact: true })).toHaveAttribute('href', '/p/kruk-kruk/')
  await expect(page.getByRole('link', { name: 'Vaata toodet e-poes' })).toHaveAttribute('href', '/p/kruk-kruk/toode/nokkmuts/')
})

test('company information remains available when the product list is empty', async ({ page }) => {
  await backend(page, { empty: true })
  await page.goto('/koduleht/')
  await expect(page.locator('.company-hero')).toBeVisible()
  await expect(page.locator('.company-feature')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'hello@example.invalid' })).toBeVisible()
})

test('unpublished shops do not expose their company page', async ({ page }) => {
  await backend(page, { closed: true })
  await page.goto('/koduleht/')
  await expect(page.getByRole('heading', { name: 'Pood on hetkel suletud.' })).toBeVisible()
  await expect(page.locator('.company-homepage')).toHaveCount(0)
  await expect(page.getByText('hello@example.invalid')).toHaveCount(0)
})

test('inline local edits support typing, multiline copy, preview, save, reload and discard', async ({ page }) => {
  const api = await backend(page)
  await page.goto('/koduleht/')
  await page.getByRole('button', { name: 'Muuda', exact: true }).click()
  const title = page.getByRole('textbox', { name: 'Pealkirja esimene rida', exact: true })
  await title.fill('Minu lugu')
  await title.press('End')
  await title.pressSequentially(' algab')
  await expect(title).toHaveText('Minu lugu algab')
  const story = page.getByRole('textbox', { name: 'Enesetutvustus', exact: true })
  await story.fill('Olen Madis.\nSee on minu uus lugu.')
  const shop = page.getByRole('textbox', { name: 'Avaploki nupp', exact: true })
  await shop.click()
  await shop.fill('Avasta looming')
  await expect(page).toHaveURL(/\/koduleht\/$/)
  await page.getByRole('button', { name: 'Eelvaade', exact: true }).click()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('#company-title')).toHaveText('Minu lugu algabmetsa.')
  await page.getByRole('button', { name: 'Salvesta eelvaade' }).click()
  await expect(page.getByRole('status')).toContainText('sellesse brauserisse salvestatud')
  await page.reload()
  await expect(page.locator('#company-title')).toContainText('Minu lugu algab')
  await expect(page.locator('.company-about__copy')).toContainText('See on minu uus lugu.')
  await page.getByRole('button', { name: 'Muuda', exact: true }).click()
  await title.fill('Ära salvesta')
  page.on('dialog', () => { throw new Error('Discard must not open a browser dialog') })
  await page.getByRole('button', { name: 'Loobu', exact: true }).click()
  await expect(page.locator('#company-title')).toContainText('Minu lugu algab')
  await page.getByRole('button', { name: 'Võta tagasi', exact: true }).click()
  await expect(title).toHaveText('Ära salvesta')
  await page.getByRole('button', { name: 'Loobu', exact: true }).click()
  expect(api.writes()).toBe(0)
})

test('owner saves public copy and contact targets, with recoverable errors', async ({ page }) => {
  const api = await backend(page, { signedIn: true, failSave: true })
  await page.goto('/koduleht/')
  await page.getByRole('button', { name: 'Muuda', exact: true }).click()
  await page.getByRole('textbox', { name: 'Pealkirja esimene rida', exact: true }).fill('Tule metsa')
  await page.getByRole('textbox', { name: 'E-post', exact: true }).fill('madis@example.invalid')
  await page.getByRole('button', { name: 'Salvesta', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Sinu muudatused on alles')
  await expect(page.getByRole('textbox', { name: 'Pealkirja esimene rida', exact: true })).toHaveText('Tule metsa')
  api.allowSaving()
  await page.getByRole('button', { name: 'Salvesta', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('salvestatud ja lehel nähtavad')
  await page.reload()
  await expect(page.locator('#company-title')).toContainText('Tule metsa')
  await expect(page.getByRole('link', { name: 'madis@example.invalid' })).toHaveAttribute('href', 'mailto:madis@example.invalid')
  expect(api.writes()).toBe(2)
})

test('mobile editor remains usable and pasted markup stays plain text', async ({ page }) => {
  await backend(page)
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/koduleht/')
  await page.getByRole('button', { name: 'Muuda', exact: true }).click()
  await page.getByRole('textbox', { name: 'Enesetutvustus', exact: true }).fill('<img src=x onerror=alert(1)>\nMinu tekst')
  await page.getByRole('textbox', { name: 'Pealkirja esimene rida', exact: true }).fill('Pikem pealkiri metsadest')
  await expect(page.locator('.company-about__copy img')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Salvesta eelvaade' })).toBeInViewport()
  await page.getByRole('button', { name: 'Salvesta eelvaade' }).click()
  await page.getByRole('button', { name: 'Valmis', exact: true }).click()
  await expect(page.locator('.company-about__copy')).toContainText('<img src=x onerror=alert(1)>')
})
