import { expect, test, type Page } from '@playwright/test'

async function openStore(page: Page, name: string) {
  await page.route('**/e2e-images/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#614827"/></svg>' }))
  await page.goto('/')
  await page.evaluate(async (storeName) => {
    const { mountStorefrontImageHarness } = await import('/e2e/image-harness.tsx')
    mountStorefrontImageHarness(storeName)
    await document.fonts.ready
  }, name)
  await expect(page.locator('.story-brand strong')).toHaveText(name.toLocaleUpperCase('et'))
}

async function headerMetrics(page: Page) {
  return page.locator('.story-brand strong').evaluate((element) => {
    const style = getComputedStyle(element)
    const range = document.createRange()
    range.selectNodeContents(element)
    const rect = element.getBoundingClientRect()
    const logo = document.querySelector('.secret-login-trigger')!.getBoundingClientRect()
    const actions = document.querySelector('.header-actions')!.getBoundingClientRect()
    return {
      size: parseFloat(style.fontSize), spacing: parseFloat(style.letterSpacing) || 0,
      available: element.clientWidth, textWidth: range.getBoundingClientRect().width,
      height: rect.height, lineHeight: parseFloat(style.lineHeight), whiteSpace: style.whiteSpace,
      overflow: style.textOverflow, right: rect.right, actionsLeft: actions.left,
      logoWidth: logo.width, logoHeight: logo.height,
      actionWidths: Array.from(document.querySelectorAll('.header-actions button')).map((button) => button.getBoundingClientRect().width),
    }
  })
}

test('fits the reported store name on one line and restores typography when the viewport grows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openStore(page, 'MoreAmoreCeramics')
  await expect.poll(async () => {
    const m = await headerMetrics(page)
    return m.textWidth <= m.available
  }).toBe(true)
  const mobile = await headerMetrics(page)
  expect(mobile.whiteSpace).toBe('nowrap')
  expect(mobile.height).toBeCloseTo(mobile.lineHeight, 0)
  expect(mobile.size).toBeGreaterThanOrEqual(12)
  expect(mobile.right).toBeLessThanOrEqual(mobile.actionsLeft)
  expect(mobile.logoWidth).toBe(48)
  expect(mobile.logoHeight).toBe(48)
  expect(mobile.actionWidths.every((width) => width >= 44)).toBe(true)
  await expect(page.locator('.toast')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/poeruum-store-name-mobile.png' })

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(async () => (await headerMetrics(page)).size).toBeCloseTo(15.2, 1)
  const desktop = await headerMetrics(page)
  expect(desktop.spacing).toBeCloseTo(desktop.size * 0.12, 2)
  expect(desktop.textWidth).toBeLessThanOrEqual(desktop.available)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => {
    const m = await headerMetrics(page)
    return m.textWidth <= m.available && m.size <= 14.08
  }).toBe(true)
})

test('keeps short names at their original size and spacing', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await openStore(page, 'Meri')
  const metrics = await headerMetrics(page)
  expect(metrics.size).toBeCloseTo(14.08, 2)
  expect(metrics.spacing).toBeCloseTo(14.08 * 0.12, 2)
  expect(metrics.textWidth).toBeLessThanOrEqual(metrics.available)
})

test('uses ellipsis at the readable minimum for an exceptionally long name', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  const name = 'Väga Pika Nimega Käsitöökeraamika Ja Disainiesemete Kauplus'
  await openStore(page, name)
  await expect.poll(async () => (await headerMetrics(page)).size).toBe(12)
  const metrics = await headerMetrics(page)
  expect(metrics.spacing).toBe(0)
  expect(metrics.overflow).toBe('ellipsis')
  expect(metrics.height).toBeCloseTo(metrics.lineHeight, 0)
  expect(metrics.right).toBeLessThanOrEqual(metrics.actionsLeft)
  expect(metrics.logoWidth).toBe(48)
  expect(metrics.actionWidths.every((width) => width >= 44)).toBe(true)
  await expect(page.locator('.story-brand strong')).toHaveAttribute('title', name)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})
