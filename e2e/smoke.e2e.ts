import { expect, test } from '@playwright/test'

test('initial platform document is light before application JavaScript runs', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  await page.goto(baseURL ?? '/')

  expect(await page.evaluate(() => ({
    surface: document.documentElement.dataset.appSurface,
    rootBackground: getComputedStyle(document.documentElement).backgroundColor,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    themeColor: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
  }))).toEqual({
    surface: 'platform',
    rootBackground: 'rgb(244, 242, 233)',
    bodyBackground: 'rgb(244, 242, 233)',
    colorScheme: 'light',
    themeColor: '#f4f2e9',
  })

  await context.close()
})

test('Kaubamaja is a minimal first-party store directory', async ({ page }) => {
  await page.goto('http://kaubamaja.localhost:4173/')

  await expect(page.getByRole('heading', { name: 'Avasta Poeruumis loodud Eesti e-poode', exact: true })).toBeVisible()
  await expect(page.locator('.store-directory__hero-media img')).toBeVisible()
  await expect(page.getByText(/Poeruumi Kaubamaja koondab ühte kohta Eesti ettevõtjate e-poed/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sirvi poode' })).toHaveAttribute('href', '#store-directory-heading')
  await expect(page.getByText('Eesti ettevõtjatelt', { exact: true })).toHaveCount(0)
  await expect(page.locator('.store-directory__marquee')).toBeVisible()
  await expect(page.getByText('Oled ettevõtja?', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Loo oma e-pood', exact: true })).toHaveAttribute('href', 'https://poeruum.ee/#hind')
  await expect(page.getByText('Kohalik kaubamaja', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Sirvi valikut', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/loodud Poeruumiga/i)).toHaveCount(0)
  await expect(page.locator('.store-directory__create svg')).toBeVisible()
  await expect(page.getByText('↗')).toHaveCount(0)
  await expect(page).toHaveTitle('Poeruumi Kaubamaja')
  await expect(page.locator('.store-directory')).toHaveCSS('background-color', 'rgb(243, 240, 231)')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByText('Oled ettevõtja?', { exact: true })).toBeHidden()
  await expect(page.locator('.store-directory__create-short')).toBeVisible()
  await expect(page.locator('.store-directory__create-full')).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('Poeruum explainer page answers who the platform is for', async ({ page }) => {
  await page.goto('/mis-on-poeruum/')

  await expect(page.getByRole('heading', { name: 'Mis on Poeruum ja kellele see sobib?', exact: true })).toBeVisible()
  await expect(page.getByText(/Poeruum on Eestis loodud e-poeplatvorm/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kellele Poeruum sobib?' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Millal tasub valida muu lahendus?' })).toBeVisible()
  await expect(page.locator('.about-poeruum__faq details')).toHaveCount(6)
  await expect(page.getByText(/väikesed ja iseseisvad/i)).toHaveCount(0)
  await expect(page).toHaveTitle('Mis on Poeruum ja kellele see sobib?')
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://poeruum.ee/mis-on-poeruum/')
})

test('landing page opens and login navigation works', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', {
      configurable: true,
      value: undefined,
    })
    const turnstileWindow = window as typeof window & {
      __completeTurnstile?: () => void
      __turnstileOptions?: Record<string, unknown>
      turnstile: {
        render: (container: HTMLElement, options: Record<string, unknown>) => string
        remove: (widgetId: string) => void
      }
    }
    turnstileWindow.turnstile = {
      render: (_container, options) => {
        turnstileWindow.__turnstileOptions = options
        turnstileWindow.__completeTurnstile = () => {
          const callback = options.callback
          if (typeof callback === 'function') callback('playwright-captcha-token')
        }
        return 'playwright-widget'
      },
      remove: () => undefined,
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Sinu e-pood/ })).toBeVisible()
  await expect(page.locator('.platform-landing > nav')).toBeVisible()
  expect(await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    scrollY: window.scrollY,
  }))).toEqual({
    background: 'rgb(244, 242, 233)',
    colorScheme: 'light',
    scrollY: 0,
  })
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
  await expect(page.getByLabel('E-posti aadress')).toBeVisible()
  await expect(page.getByLabel('Parool')).toBeVisible()
  const submitButton = page.getByRole('button', { name: /Jätka oma poega/ })
  await expect(submitButton).toBeEnabled()
  expect(await page.evaluate(() => {
    const turnstileWindow = window as typeof window & {
      __turnstileOptions?: Record<string, unknown>
    }
    return {
      appearance: turnstileWindow.__turnstileOptions?.appearance,
      language: turnstileWindow.__turnstileOptions?.language,
      retry: turnstileWindow.__turnstileOptions?.retry,
      retryInterval: turnstileWindow.__turnstileOptions?.['retry-interval'],
    }
  })).toEqual({ appearance: 'always', language: 'auto', retry: 'auto', retryInterval: 4000 })
  await page.getByLabel('E-posti aadress').fill('test@example.com')
  await page.getByLabel('Parool').fill('test-password')
  await submitButton.click()
  await expect(page.getByRole('alert')).toHaveText('Kinnita enne jätkamist, et sa ei ole robot.')
  await page.evaluate(() => {
    const turnstileWindow = window as typeof window & { __completeTurnstile?: () => void }
    turnstileWindow.__completeTurnstile?.()
  })
  await expect(submitButton).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('legal routes render their dedicated documents', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('.platform-footer a[href="/privaatsus"]').click()
  await expect(page).toHaveURL(/\/privaatsus\/?$/)
  await expect(page.getByRole('heading', { name: /Kuidas Poeruum/ })).toBeVisible()
  await expect(page).toHaveTitle(/Privaatsus/)

  const brand = page.locator('.legal-nav .platform-brand')
  const mark = brand.locator('.platform-brand__mark')
  await expect(brand).toHaveCSS('display', 'inline-flex')
  await expect(mark.locator('rect')).toHaveCSS('fill', 'rgb(38, 95, 67)')
  await expect(mark.locator('path').first()).toHaveCSS('fill', 'none')
  await expect(mark.locator('path').first()).toHaveCSS('stroke', 'rgb(229, 242, 90)')

  const [markBox, nameBox] = await Promise.all([
    mark.boundingBox(),
    brand.locator('strong').boundingBox(),
  ])
  expect(markBox).not.toBeNull()
  expect(nameBox).not.toBeNull()
  expect(Math.abs(
    (markBox?.y ?? 0) + (markBox?.height ?? 0) / 2
      - ((nameBox?.y ?? 0) + (nameBox?.height ?? 0) / 2),
  )).toBeLessThan(2)

  await page.locator('.legal-nav a[href="/kasutustingimused"]').click()
  await expect(page).toHaveURL(/\/kasutustingimused\/?$/)
  await expect(page.getByRole('heading', { name: /Poeruumi teenuse/ })).toBeVisible()
  await expect(page).toHaveTitle(/Kasutustingimused/)
})

test('storefront preview owns its toolbar styles independently', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Vaata näidispoodi' }).click()

  const previewBar = page.locator('.platform-preview-bar')
  await expect(previewBar).toBeVisible()
  await page.locator('style[data-vite-dev-id$="/src/platform.css"]').evaluate((style) => style.remove())

  await expect(previewBar).toHaveCSS('position', 'fixed')
  await expect(previewBar).toHaveCSS('display', 'flex')
  await expect(previewBar).toHaveCSS('background-color', 'rgb(229, 242, 90)')
  await expect(previewBar.getByRole('button')).toHaveCSS('border-radius', '10.4px')
})

test('storefront modal close button owns mobile taps', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()

  await page.goto(`${baseURL}/`)
  await page.getByRole('link', { name: 'Ava näidispood' }).tap()

  await page.getByRole('button', { name: 'Poe omanik? Logi sisse' }).tap()
  const dialog = page.getByRole('dialog', { name: 'Logi sisse' })
  const closeButton = dialog.getByRole('button', { name: 'Sulge' })
  await expect(dialog).toBeVisible()
  await expect(closeButton).toHaveCSS('z-index', '10')
  await expect(closeButton).toHaveCSS('touch-action', 'manipulation')

  await closeButton.tap()
  await expect(dialog).toHaveCount(0)
  await context.close()
})

test('support launcher is limited to the owner editing view', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Vaata näidispoodi' }).click()

  const supportProbe = page.locator('.support-launcher')
  await page.locator('.app-shell').evaluate((storefront) => {
    const launcher = document.createElement('button')
    launcher.className = 'support-launcher'
    launcher.textContent = 'Abi'
    storefront.after(launcher)
  })

  await expect(supportProbe).toBeHidden()
  await page.locator('.app-shell').evaluate((storefront) => { storefront.dataset.editing = 'true' })
  await expect(supportProbe).toBeVisible()
})

test('admin support keeps the reply composer visible while messages scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Supabase pole ühendatud' })).toBeVisible()

  await page.evaluate(() => {
    const message = `<article><span>Saatja <time>3. sept</time></span><p>${'Pikk klienditoe sõnum. '.repeat(80)}</p></article>`
    document.body.innerHTML = `<main class="admin-shell">
      <aside class="admin-sidebar"></aside>
      <section class="admin-main">
        <section class="admin-support">
          <header><div><span>KLIENDITUGI</span><h2>Vestlused</h2><p>Kasutajate küsimused.</p></div></header>
          <div class="admin-support__filters"><button>Aktiivsed</button></div>
          <div class="admin-support__workspace">
            <div class="admin-support__list"></div>
            <div class="admin-support__conversation">
              <header><div><small>Poe seadistamine</small><h3>Vestlus</h3><p>Klient</p></div></header>
              <div class="admin-support__messages">${message.repeat(4)}</div>
              <form><textarea rows="4" placeholder="Kirjuta saatjale vastus…"></textarea><div><button>Saada vastus</button></div></form>
            </div>
          </div>
        </section>
      </section>
    </main>`
  })

  const workspace = page.locator('.admin-support__workspace')
  const messages = page.locator('.admin-support__messages')
  const replyForm = page.locator('.admin-support__conversation > form')
  await expect(replyForm).toBeVisible()
  await expect(messages).toHaveCSS('overflow-y', 'auto')
  expect(await page.evaluate(() => {
    const workspaceElement = document.querySelector<HTMLElement>('.admin-support__workspace')!
    const messagesElement = document.querySelector<HTMLElement>('.admin-support__messages')!
    const formElement = document.querySelector<HTMLElement>('.admin-support__conversation > form')!
    const workspaceBounds = workspaceElement.getBoundingClientRect()
    const formBounds = formElement.getBoundingClientRect()
    return {
      composerInsideWorkspace: formBounds.bottom <= workspaceBounds.bottom + 1,
      messagesAreScrollable: messagesElement.scrollHeight > messagesElement.clientHeight,
      workspaceInsideViewport: workspaceBounds.bottom <= window.innerHeight,
    }
  })).toEqual({
    composerInsideWorkspace: true,
    messagesAreScrollable: true,
    workspaceInsideViewport: true,
  })
  await expect(workspace).toBeVisible()
})

test('a stale settings response cannot overwrite text being typed', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountSettingsHarness } = await import('/e2e/settings-harness.tsx')
    mountSettingsHarness()
  })

  await page.getByRole('button', { name: /Seaded/ }).click()
  await page.locator('.settings-home button[data-section="store"]').click()
  const description = page.getByLabel('Poe tutvustus')
  await description.fill('Telefonis kirjutatud uus tekst')

  await page.evaluate(() => window.__updateSettingsHarness?.({ storeDescription: 'Serverist hilinenud vana tekst' }))
  await expect(description).toHaveValue('Telefonis kirjutatud uus tekst')
})

test('customers filter products by category inside search', async ({ page }) => {
  const imageBody = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="navy"/></svg>'
  await page.route('**/e2e-images/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: imageBody }))
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountCategorySearchHarness } = await import('/e2e/settings-harness.tsx')
    mountCategorySearchHarness()
  })

  await page.getByRole('button', { name: 'Otsi ja sirvi kategooriaid' }).click()
  const search = page.getByRole('dialog', { name: 'Tooteotsing ja kategooriad' })
  await expect(search.getByRole('heading', { name: 'Kategooriad' })).toBeVisible()
  await expect(search.getByRole('button', { name: /Ehted 1/ })).toBeVisible()
  await expect(search.getByRole('button', { name: /Kodu 2/ })).toBeVisible()
  await expect(search.getByRole('button', { name: /Tühi/ })).toHaveCount(0)

  await search.getByRole('button', { name: /Ehted 1/ }).click()
  await expect(search.locator('.search-results > button')).toHaveCount(1)
  await expect(search.getByText('Hõbedane sõrmus')).toBeVisible()
  await expect(search.getByText('Savikruus')).toHaveCount(0)

  await search.getByRole('button', { name: 'Eemalda filter' }).click()
  await expect(search.locator('.search-results > button')).toHaveCount(3)
})

test('a merchant creates and selects a category while editing a product', async ({ page }) => {
  const imageBody = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="navy"/></svg>'
  await page.route('**/e2e-images/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: imageBody }))
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountCategoryEditorHarness } = await import('/e2e/settings-harness.tsx')
    mountCategoryEditorHarness()
  })

  await page.getByRole('button', { name: 'Muuda toodet' }).click()
  await page.getByRole('button', { name: '+ Uus' }).click()
  await page.getByLabel('Uue kategooria nimi').fill('Kingitused')
  await page.getByRole('button', { name: 'Loo', exact: true }).click()
  await expect(page.getByLabel('Toote kategooria')).toHaveValue(/category-/)
  await expect(page.getByLabel('Toote kategooria').locator('option:checked')).toHaveText('Kingitused')
})

test('a merchant can open Stripe remediation from Poeruum settings', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountStripeRequirementsHarness } = await import('/e2e/settings-harness.tsx')
    mountStripeRequirementsHarness()
  })

  await page.getByRole('button', { name: /Seaded/ }).click()
  await page.locator('.settings-home button[data-section="payments"]').click()
  await expect(page.getByText('Stripe leidis andmetes parandamist vajava koha')).toBeVisible()
  await expect(page.getByText('Dokumendil olev aadress ei ühti ettevõtte aadressiga')).toBeVisible()
  await expect(page.getByText(/Stripe’i kontol ja üles laaditud kehtival dokumendil/)).toBeVisible()
  await expect(page.getByText(/09\.10\.2026/)).toBeVisible()

  await page.getByRole('button', { name: 'Kinnita ettevõtte andmed' }).click()
  await expect.poll(() => page.evaluate(() => window.__stripeConnectCalls)).toBe(1)
  await expect.poll(() => page.evaluate(() => window.__stripeConnectPurpose)).toBe('requirements')

  await page.getByRole('button', { name: 'Halda Stripe’i kontot ja väljamakseid' }).click()
  await expect.poll(() => page.evaluate(() => window.__stripeConnectCalls)).toBe(2)
  await expect.poll(() => page.evaluate(() => window.__stripeConnectPurpose)).toBe('management')
})

test('a Stripe requirements email target opens merchant payment settings directly', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountStripeRequirementsLinkHarness } = await import('/e2e/settings-harness.tsx')
    mountStripeRequirementsLinkHarness()
  })

  const settings = page.getByRole('dialog', { name: 'Seaded' })
  await expect(settings).toBeVisible()
  await expect(settings.getByRole('heading', { name: 'Maksed' })).toBeVisible()
  await expect(settings.locator('.payments-panel')).toBeVisible()
})

test('a late Stripe requirements target opens payment settings on an already mounted storefront', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountLateStripeRequirementsLinkHarness } = await import('/e2e/settings-harness.tsx')
    mountLateStripeRequirementsLinkHarness()
  })

  await expect(page.getByRole('dialog', { name: 'Seaded' })).toHaveCount(0)
  await page.evaluate(() => window.__openLateStripeRequirementsSettings?.())

  const settings = page.getByRole('dialog', { name: 'Seaded' })
  await expect(settings).toBeVisible()
  await expect(settings.getByRole('heading', { name: 'Maksed' })).toBeVisible()
  await expect(settings.locator('.payments-panel')).toBeVisible()
})

test('an order thumbnail falls back to the current product image', async ({ page }) => {
  const imageBody = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lime"/></svg>'
  await page.route('**/e2e-images/missing.jpg', (route) => route.fulfill({ status: 404 }))
  await page.route('**/e2e-images/current.jpg', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: imageBody }))
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountOrderImageHarness } = await import('/e2e/image-harness.tsx')
    mountOrderImageHarness()
  })

  const thumbnail = page.locator('#order-image-harness img')
  await expect(thumbnail).toBeVisible()
  await expect.poll(() => thumbnail.evaluate((image) => ({
    source: image.currentSrc,
    width: image.naturalWidth,
  }))).toEqual({
    source: 'http://localhost:4173/e2e-images/current.jpg',
    width: 40,
  })
})

test('the visible product image loads before non-critical storefront images', async ({ page }) => {
  const requestedImages: string[] = []
  let releaseFirstImage = () => undefined
  const firstImageGate = new Promise<void>((resolve) => { releaseFirstImage = resolve })
  const imageBody = '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="navy"/></svg>'
  await page.route('**/e2e-images/**', async (route) => {
    const imageName = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
    requestedImages.push(imageName)
    if (imageName === 'first.jpg') await firstImageGate
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: imageBody })
  })
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountStorefrontImageHarness } = await import('/e2e/image-harness.tsx')
    mountStorefrontImageHarness()
  })

  await expect.poll(() => requestedImages.includes('first.jpg')).toBe(true)
  const slidesBeforeFirstImage = await page.locator('.story-slide img').evaluateAll((images) => images.map((image) => ({
    source: image.getAttribute('src'),
    loading: image.loading,
    priority: image.fetchPriority,
  })))
  expect(slidesBeforeFirstImage.filter((image) => image.priority === 'high')).toEqual([{
    source: '/e2e-images/first.jpg',
    loading: 'eager',
    priority: 'high',
  }])
  expect(slidesBeforeFirstImage.filter((image) => image.priority === 'low').every((image) => image.source?.startsWith('data:image/svg+xml'))).toBe(true)
  expect(requestedImages).not.toContain('second.jpg')
  expect(requestedImages).not.toContain('gallery.jpg')
  expect(requestedImages).not.toContain('about.jpg')
  await expect(page.locator('.site-footer__about-image img')).toHaveAttribute('loading', 'lazy')
  await expect.poll(() => page.evaluate(() => window.__initialStorefrontVisualReadyCount ?? 0)).toBe(0)

  releaseFirstImage()
  await expect.poll(() => requestedImages.includes('second.jpg')).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__initialStorefrontVisualReadyCount ?? 0)).toBe(1)
})

test('storefront loading shows the store logo when one is available', async ({ page }) => {
  const imageBody = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><circle cx="64" cy="64" r="60" fill="black"/><path d="M64 28v72M28 64h72" stroke="white" stroke-width="10"/></svg>'
  await page.route('**/e2e-images/loading-logo.jpg', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: imageBody }))
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountStorefrontLoadingHarness } = await import('/e2e/image-harness.tsx')
    mountStorefrontLoadingHarness()
  })

  const loading = page.getByLabel('Laadin poodi Logo pood')
  const logo = loading.locator('.storefront-loading__brand img')
  await expect(loading).toBeVisible()
  await expect(logo).toBeVisible()
  await expect(logo).toHaveJSProperty('naturalWidth', 128)
  await expect(logo).toHaveAttribute('fetchpriority', 'high')
  await expect(loading.locator('.storefront-loading__spinner')).toHaveCount(0)
  await expect(loading.locator('.storefront-loading__brand i')).toHaveCount(0)

  await page.evaluate(() => window.__finishStorefrontLoading?.())
  await expect(loading).toHaveClass(/is-leaving/)
  await expect(loading).toBeHidden()
})

test('admin route fails closed when backend configuration is absent', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Supabase pole ühendatud' })).toBeVisible()
  await expect(page.getByText('SEADISTUS PUUDUB')).toBeVisible()
  expect(await page.evaluate(() => ({
    surface: document.documentElement.dataset.appSurface,
    rootBackground: getComputedStyle(document.documentElement).backgroundColor,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    themeColor: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
  }))).toEqual({
    surface: 'platform',
    rootBackground: 'rgb(244, 242, 233)',
    bodyBackground: 'rgb(244, 242, 233)',
    colorScheme: 'light',
    themeColor: '#f4f2e9',
  })
})

test('analytics admin route is protected by the admin shell', async ({ page }) => {
  await page.goto('/admin/analytics')
  await expect(page).toHaveURL(/\/admin\/analytics$/)
  await expect(page.getByRole('heading', { name: 'Supabase pole ühendatud' })).toBeVisible()
  await expect(page.getByText('SEADISTUS PUUDUB')).toBeVisible()
})

test('removed admin homepage route returns to the overview', async ({ page }) => {
  await page.goto('/admin/homepage')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Supabase pole ühendatud' })).toBeVisible()
})
