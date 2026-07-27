import { expect, test } from '@playwright/test'

test('landing page opens and login navigation works', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', {
      configurable: true,
      value: undefined,
    })
    const turnstileWindow = window as typeof window & {
      turnstile: {
        render: (container: HTMLElement, options: Record<string, unknown>) => string
        remove: (widgetId: string) => void
      }
    }
    turnstileWindow.turnstile = {
      render: (container, options) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = 'Kinnita test-botikaitse'
        button.addEventListener('click', () => {
          const callback = options.callback
          if (typeof callback === 'function') callback('playwright-captcha-token')
        })
        container.append(button)
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
  await page.locator('.turnstile-field button').click()
  await expect(submitButton).toBeEnabled()
  expect(pageErrors).toEqual([])
})

test('legal routes render their dedicated documents', async ({ page }) => {
  await page.goto('/kasutustingimused')
  await expect(page.getByRole('heading', { name: /Poeruumi teenuse/ })).toBeVisible()
  await expect(page).toHaveTitle(/Kasutustingimused/)

  await page.goto('/privaatsus')
  await expect(page.getByRole('heading', { name: /Kuidas Poeruum/ })).toBeVisible()
  await expect(page).toHaveTitle(/Privaatsus/)
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
})
