import { expect, test, type Page } from '@playwright/test'

async function openStore(page: Page, count = 4, imageCount = 1, width = 1440, autoplay = false) {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/')
  await page.evaluate(async ({ productCount, imageCount, autoplay }) => {
    const { mountStorefrontNavigationHarness } = await import('/e2e/storefront-preview-harness.tsx')
    mountStorefrontNavigationHarness(productCount, imageCount, autoplay)
  }, { productCount: count, imageCount, autoplay })
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

for (const count of [1, 3]) test(`shop logo returns to the first product and photo without losing the cart (${count} products)`, async ({ page }) => {
  await openStore(page, count, 3, 390)
  await page.locator('.buy-now').click()
  await page.locator('.cart-overlay').getByRole('button', { name: 'Sulge', exact: true }).click()
  await page.getByRole('button', { name: 'Pilt 3', exact: true }).click()
  await expectImage(page, 3, count)
  const brand = page.getByRole('link', { name: 'Ringipood poe avaleht', exact: true })
  await expect(brand).toHaveAttribute('href', '/p/ringipood/')
  await brand.focus()
  await page.keyboard.press('Enter')
  await expectProduct(page, 1)
  await expectImage(page, 1)
  await expect(page).toHaveURL(/\/p\/ringipood\/$/)
  await expect(page.getByRole('button', { name: 'Ostukorv, 1 toodet', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

async function expectImage(page: Page, number: number, productNumber = 1) {
  await expect(page.getByRole('button', { name: `Pilt ${number}`, exact: true })).toHaveClass('is-active')
  const image = page.locator('.story-slide img[fetchpriority="high"]')
  await expect.poll(async () => decodeURIComponent(await image.getAttribute('src') ?? '')).toContain(`>${productNumber}:${number}</text>`)
}

async function swipePhoto(page: Page, direction: 'next' | 'previous') {
  const touch = await page.context().newCDPSession(page)
  const from = direction === 'next' ? 320 : 70
  const to = direction === 'next' ? 70 : 320
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y: 350 }] })
  for (let step = 1; step <= 12; step++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + (to - from) * step / 12, y: 350 }] })
    await page.waitForTimeout(25)
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await touch.detach()
}

for (const imageCount of [2, 3]) {
  test(`one product with ${imageCount} photos swipes through the gallery in both directions`, async ({ page }) => {
    await openStore(page, 1, imageCount, 390)
    const url = page.url()
    await expectImage(page, 1)
    for (const number of [...Array.from({ length: imageCount - 1 }, (_, index) => index + 2), 1]) {
      await swipePhoto(page, 'next')
      await expectImage(page, number)
      await expect.poll(() => page.locator('.story-track').evaluate((track) => track.scrollLeft / track.clientWidth)).toBe(number)
    }
    await swipePhoto(page, 'previous')
    await expectImage(page, imageCount)
    await expect.poll(() => page.locator('.story-track').evaluate((track) => track.scrollLeft / track.clientWidth)).toBe(imageCount)
    await expect(page.locator('.product-details h1')).toHaveText('Ese 1')
    await expect(page).toHaveURL(url)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)

    await page.getByRole('button', { name: 'Pilt 1', exact: true }).click()
    await expectImage(page, 1)
    await expect.poll(() => page.locator('.story-track').evaluate((track) => track.scrollLeft / track.clientWidth)).toBe(1)
    await swipePhoto(page, 'next')
    await expectImage(page, 2)
  })
}

test('single-product gallery arrows and resizing keep the selected photo', async ({ page }) => {
  await openStore(page, 1, 3)
  const url = page.url()
  for (const number of [2, 3, 1]) {
    await page.getByRole('button', { name: 'Järgmine pilt', exact: true }).click()
    await expectImage(page, number)
    await expect.poll(() => page.locator('.story-track').evaluate((track) => track.scrollLeft / track.clientWidth)).toBe(number)
  }
  await page.getByRole('button', { name: 'Eelmine pilt', exact: true }).click()
  await expectImage(page, 3)
  await expect.poll(() => page.locator('.story-track').evaluate((track) => track.scrollLeft / track.clientWidth)).toBe(3)
  await page.setViewportSize({ width: 390, height: 900 })
  await expectImage(page, 3)
  await expect.poll(() => page.locator('.story-track').evaluate((track) => track.scrollLeft / track.clientWidth)).toBe(3)
  await expect(page).toHaveURL(url)
})

test('multiple products still swipe between products and remember each selected photo', async ({ page }) => {
  await openStore(page, 3, 3, 390)
  await page.getByRole('button', { name: 'Pilt 2', exact: true }).click()
  await expectImage(page, 2, 3)
  await swipePhoto(page, 'next')
  await expectProduct(page, 1)
  await expectImage(page, 1)
  await swipePhoto(page, 'previous')
  await expectProduct(page, 3)
  await expectImage(page, 2, 3)
})

test('single-product screensaver advances gallery photos and wakes on interaction', async ({ page }) => {
  await openStore(page, 1, 3, 1440, true)
  await expect(page.locator('.app-shell')).toHaveAttribute('data-screensaver', 'active')
  await expectImage(page, 2)
  await expectImage(page, 3)
  await expectImage(page, 1)
  await page.locator('.story-stage').hover({ position: { x: 100, y: 250 } })
  await expect(page.locator('.app-shell')).toHaveAttribute('data-screensaver', 'idle')
})
