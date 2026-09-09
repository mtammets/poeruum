import { expect, test, type Page } from '@playwright/test'

async function openEditor(page: Page, salePrice?: number) {
  const storeId = '10000000-0000-4000-8000-000000000092'
  const imageUrl = `http://localhost:4174/storage/v1/object/public/product-images/${storeId}/image/medium.webp`
  let product = {
    id: 'pricing-product', store_id: storeId, name: 'Savivaas', alt: 'Savivaas', description: 'Kõrgus 25 cm.',
    image_url: imageUrl, gallery: [imageUrl], price: 25, sale_price: salePrice ?? null, search_visible: true,
  }
  const saves: typeof product[] = []
  await page.route('**/storage/v1/object/public/product-images/**', (route) => route.fulfill({ contentType: 'image/webp', path: 'public/images/poeruumi-kaubamaja-hero2.webp' }))
  await page.route('**/__e2e_supabase/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/rest/v1/products')) {
      if (route.request().method() === 'POST') {
        product = route.request().postDataJSON()
        saves.push(product)
        await route.fulfill({ json: product })
      } else await route.fulfill({ json: [product] })
    } else await route.fulfill({ json: url.pathname.includes('/rpc/') ? null : [] })
  })
  await page.goto('http://localhost:4174/')
  await expect(page.getByRole('heading', { name: /Sinu e-pood/ })).toBeVisible()
  const loadedProducts = page.waitForResponse((response) => response.url().includes('/rest/v1/products'))
  await page.evaluate(async (sale) => {
    const { mountProductPricingHarness } = await import('/e2e/product-pricing-harness.tsx')
    mountProductPricingHarness(sale)
  }, salePrice)
  await loadedProducts
  await page.getByRole('button', { name: 'Muuda toodet' }).click()
  return saves
}

test('removes an existing discount, saves the regular price and allows adding it again', async ({ page }) => {
  const saves = await openEditor(page, 20)
  const regularPrice = page.getByRole('textbox', { name: 'Toote tavahind' })
  const salePrice = page.getByRole('textbox', { name: 'Toote soodushind' })
  await salePrice.fill('')
  await expect(salePrice).toBeVisible()
  expect((await salePrice.boundingBox())?.width).toBeGreaterThan(50)
  await salePrice.click()
  await salePrice.fill('19')
  await page.getByRole('button', { name: 'Eemalda allahindlus' }).click()
  await expect(salePrice).toHaveValue('')
  await expect(regularPrice).toHaveValue('25')
  await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
  await expect(page.getByRole('button', { name: 'Muuda toodet' })).toBeVisible()
  expect(saves[0]).toMatchObject({ price: 25, sale_price: null })
  await expect(page.locator('.price-value')).toHaveText('25 €')
  await expect(page.locator('.sale-badge')).toHaveCount(0)

  await page.getByRole('button', { name: 'Muuda toodet' }).click()
  await expect(salePrice).toHaveValue('')
  await salePrice.fill('17,50')
  await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
  await expect(page.getByRole('button', { name: 'Muuda toodet' })).toBeVisible()
  expect(saves[1]).toMatchObject({ price: 25, sale_price: 17.5 })
  await expect(page.locator('.price-value del')).toHaveText('25 €')
  await expect(page.locator('.price-value strong')).toHaveText('17.5 €')
  await expect(page.locator('.buy-now strong')).toHaveText('17.5 €')
})

test('keeps empty price fields usable on mobile and preserves edits after a validation error', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const saves = await openEditor(page, 20)
  const regularPrice = page.getByRole('textbox', { name: 'Toote tavahind' })
  const salePrice = page.getByRole('textbox', { name: 'Toote soodushind' })
  await regularPrice.fill('')
  await salePrice.fill('1')
  await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
  await expect(page.getByText('Lisa korrektne tavahind. Allahindluse eemaldamiseks jäta soodushind tühjaks.', { exact: true })).toBeVisible()
  await expect(regularPrice).toHaveValue('')
  await expect(salePrice).toHaveValue('1')
  expect(saves).toHaveLength(0)
  await regularPrice.click()
  await regularPrice.fill('25')
  await salePrice.fill('')
  await salePrice.click()
  expect((await salePrice.boundingBox())?.width).toBeGreaterThan(50)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
  await expect(page.getByRole('button', { name: 'Muuda toodet' })).toBeVisible()
  expect(saves[0]).toMatchObject({ price: 25, sale_price: null })
})

for (const value of [0, 1]) {
  test(`accepts ${value} as a discount below the regular price and retains it when reopening`, async ({ page }) => {
    const saves = await openEditor(page, 20)
    await page.getByRole('textbox', { name: 'Toote soodushind' }).fill(String(value))
    await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
    await expect(page.getByRole('button', { name: 'Muuda toodet' })).toBeVisible()
    expect(saves[0]).toMatchObject({ price: 25, sale_price: value })
    await expect(page.locator('.buy-now strong')).toHaveText(`${value} €`)
    await page.getByRole('button', { name: 'Muuda toodet' }).click()
    await expect(page.getByRole('textbox', { name: 'Toote soodushind' })).toHaveValue(String(value))
  })
}

test('saves a product without a discount and discards cancelled discount edits', async ({ page }) => {
  const saves = await openEditor(page)
  const salePrice = page.getByRole('textbox', { name: 'Toote soodushind' })
  await expect(salePrice).toHaveValue('')
  await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
  await expect(page.getByRole('button', { name: 'Muuda toodet' })).toBeVisible()
  expect(saves[0]).toMatchObject({ price: 25, sale_price: null })
  await page.getByRole('button', { name: 'Muuda toodet' }).click()
  await salePrice.fill('12')
  await page.getByRole('button', { name: 'Loobu muudatustest' }).click()
  await page.getByRole('button', { name: 'Muuda toodet' }).click()
  await expect(salePrice).toHaveValue('')
  expect(saves).toHaveLength(1)
})

test('rejects invalid discounts without losing edits and allows correcting them', async ({ page }) => {
  const saves = await openEditor(page, 20)
  const salePrice = page.getByRole('textbox', { name: 'Toote soodushind' })
  for (const invalid of ['25', '30', '-1', 'abc']) {
    await salePrice.fill(invalid)
    await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
    await expect(page.getByText('Soodushind peab olema vähemalt 0 ja tavahinnast väiksem. Allahindluse eemaldamiseks jäta see tühjaks.', { exact: true })).toBeVisible()
    await expect(salePrice).toHaveValue(invalid)
    await expect(page.getByRole('textbox', { name: 'Toote tavahind' })).toHaveValue('25')
    expect(saves).toHaveLength(0)
  }
  await salePrice.fill('1')
  await expect(page.getByText('Soodushind peab olema vähemalt 0 ja tavahinnast väiksem. Allahindluse eemaldamiseks jäta see tühjaks.', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
  await expect(page.getByRole('button', { name: 'Muuda toodet' })).toBeVisible()
  expect(saves[0]).toMatchObject({ price: 25, sale_price: 1 })
})
