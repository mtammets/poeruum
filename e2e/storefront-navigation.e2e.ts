import { expect, test, type Page } from '@playwright/test'

async function openStore(page: Page, count = 4) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.evaluate(async (productCount) => {
    const { mountStorefrontNavigationHarness } = await import('/e2e/storefront-preview-harness.tsx')
    mountStorefrontNavigationHarness(productCount)
  }, count)
  await expectProduct(page, count)
  await page.locator('.story-stage').hover()
}

async function expectProduct(page: Page, number: number) {
  await expect(page.locator('.product-details h1')).toHaveText(`Ese ${number}`)
  await expect(page.locator('.product-price .price-value strong')).toHaveText(`${number * 10} €`)
  await expect(page.getByRole('button', { name: `Toode ${number}`, exact: true })).toHaveClass('is-active')
  // Wait for the loop's clone slide to settle at its real position.
  await expect.poll(() => page.locator('.story-track').evaluate((track) => track.scrollLeft / track.clientWidth)).toBe(number)
}

async function recordVisibleProducts(page: Page) {
  await page.evaluate(() => {
    const heading = document.querySelector('.product-details h1')!
    const names = new Set([heading.textContent])
    const observer = new MutationObserver(() => names.add(heading.textContent))
    observer.observe(heading, { childList: true, subtree: true, characterData: true })
    Object.assign(window, { finishProductRecording: () => { observer.disconnect(); return [...names] } })
  })
}

async function recordedProducts(page: Page) {
  return page.evaluate(() => (window as typeof window & { finishProductRecording: () => string[] }).finishProductRecording())
}

test('product arrows loop both ways without passing through other products', async ({ page }) => {
  await openStore(page)
  const next = page.getByRole('button', { name: 'Järgmine toode', exact: true })
  const previous = page.getByRole('button', { name: 'Eelmine toode', exact: true })
  await expect(next).toBeEnabled()

  await recordVisibleProducts(page)
  await next.click()
  await expectProduct(page, 1)
  await expect(page).toHaveURL(/\/toode\/toode-1\/$/)
  expect(await recordedProducts(page)).toEqual(['Ese 4', 'Ese 1'])

  await expect(previous).toBeEnabled()
  await recordVisibleProducts(page)
  await previous.click()
  await expectProduct(page, 4)
  await expect(page).toHaveURL(/\/toode\/toode-4\/$/)
  expect(await recordedProducts(page)).toEqual(['Ese 1', 'Ese 4'])

  // The loop remains usable across multiple circuits and ordinary steps.
  for (const number of [1, 2, 3, 4, 1]) {
    await next.click()
    await expectProduct(page, number)
    await expect(page).toHaveURL(new RegExp(`/toode/toode-${number}/$`))
  }
})

test('a single-product store keeps both navigation arrows disabled', async ({ page }) => {
  await openStore(page, 1)
  await expect(page.getByRole('button', { name: 'Eelmine toode', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Järgmine toode', exact: true })).toBeDisabled()
})
