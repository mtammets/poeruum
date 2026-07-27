import { expect, test } from '@playwright/test'

test('landing page opens and login navigation works', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', {
      configurable: true,
      value: undefined,
    })
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

test('admin route fails closed when backend configuration is absent', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Supabase pole ühendatud' })).toBeVisible()
  await expect(page.getByText('SEADISTUS PUUDUB')).toBeVisible()
})
