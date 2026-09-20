import { expect, test } from '@playwright/test'

test('homepage offers eight real products across stores with prices and keyboard-accessible direct links', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountDirectoryCatalogHarness } = await import('/e2e/directory-harness.tsx')
    const imageUrl = `${window.location.origin}/images/poeruumi-kaubamaja-hero.webp`
    mountDirectoryCatalogHarness(Array.from({ length: 4 }, (_, index) => ({
      store_id: `store-${index}`, store_name: `Pood ${index + 1}`, store_slug: `pood-${index + 1}`,
      primary_hostname: index === 1 ? 'puit.example.ee' : undefined,
      products: [
        { id: 'sold-out', name: 'Otsas', image_url: imageUrl, price: 5, stock: 0 },
        { id: 'hidden', name: 'Peidetud', image_url: imageUrl, price: 5, search_visible: false },
        { id: 'no-picture', name: 'Pildita', price: 5 },
        { id: 'no-price', name: 'Hinnata', image_url: imageUrl },
        ...Array.from({ length: index === 0 ? 10 : 1 }, (_, productIndex) => ({
          id: `product-${productIndex}`, name: `Toode ${index + 1}.${productIndex + 1}`, slug: `toode-${productIndex + 1}`,
          image_url: imageUrl, price: 30, sale_price: index === 1 ? 24 : null, stock: 1,
        })),
      ],
    })))
  })
  const highlights = page.getByRole('region', { name: 'Leia oma uus lemmik', exact: true })
  const cards = highlights.locator('article')
  await expect(cards).toHaveCount(8)
  await expect(highlights.locator('.store-directory__product-store')).toHaveText(['Pood 1', 'Pood 2', 'Pood 3', 'Pood 4', 'Pood 1', 'Pood 1', 'Pood 1', 'Pood 1'])
  await expect(highlights.getByText('Vaata toodet')).toHaveCount(8)
  await expect(highlights.getByRole('heading', { level: 3 })).toHaveText(['Toode 1.1', 'Toode 2.1', 'Toode 3.1', 'Toode 4.1', 'Toode 1.2', 'Toode 1.3', 'Toode 1.4', 'Toode 1.5'])
  const discounted = cards.nth(1)
  await expect(discounted.locator('strong')).toHaveText('24 €')
  await expect(discounted.locator('del')).toHaveText('30 €')
  await expect(discounted.getByRole('link')).toHaveAttribute('href', 'https://puit.example.ee/toode/toode-1/?from=kaubamaja')
  await highlights.scrollIntoViewIfNeeded()
  await expect.poll(() => highlights.locator('img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await highlights.screenshot({ path: 'output/directory-highlights-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(cards).toHaveCount(8)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await highlights.screenshot({ path: 'output/directory-highlights-mobile.png' })
  await page.route('https://puit.example.ee/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Toote leht</h1>' }))
  await discounted.getByRole('link').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('https://puit.example.ee/toode/toode-1/?from=kaubamaja')
})

test('homepage omits an empty product selection', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountDirectoryCatalogHarness } = await import('/e2e/directory-harness.tsx')
    mountDirectoryCatalogHarness([])
  })
  await expect(page.getByRole('heading', { name: 'Leia oma uus lemmikpood' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Leia oma uus lemmik', exact: true })).toHaveCount(0)
})
