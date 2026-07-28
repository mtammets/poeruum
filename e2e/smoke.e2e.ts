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
  await expect(submitButton).toBeDisabled()
  expect(await page.evaluate(() => {
    const turnstileWindow = window as typeof window & {
      __turnstileOptions?: Record<string, unknown>
    }
    return {
      appearance: turnstileWindow.__turnstileOptions?.appearance,
      language: turnstileWindow.__turnstileOptions?.language,
    }
  })).toEqual({ appearance: 'interaction-only', language: 'auto' })
  await page.evaluate(() => {
    const turnstileWindow = window as typeof window & { __completeTurnstile?: () => void }
    turnstileWindow.__completeTurnstile?.()
  })
  await expect(submitButton).toBeEnabled()
  expect(pageErrors).toEqual([])
})

test('legal routes render their dedicated documents', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/kasutustingimused')
  await expect(page.getByRole('heading', { name: /Poeruumi teenuse/ })).toBeVisible()
  await expect(page).toHaveTitle(/Kasutustingimused/)

  await page.goto('/privaatsus')
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
