import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { PNG } from 'pngjs'
import jsQR from 'jsqr'

const USER_ID = '20000000-0000-4000-8000-000000000001'
const STORE_ID = '10000000-0000-4000-8000-000000000001'

test('homepage embeds the real storefront settings and details in its phone', async ({ page }) => {
  await installSupabaseBackend(page)
  const imageRoot = 'http://localhost:4174/storage/v1/object/public/product-images/homepage-test'
  const products = ['lamp', 'vase', 'tray'].map((name, index) => {
    const image = `${imageRoot}/${name}/master.svg`
    const variant = (role: string, width: number, height: number) => ({ url: `${imageRoot}/${name}/${role}.svg`, width, height, bytes: width })
    return {
      id: name, store_id: STORE_ID, name, image_url: image, gallery: [image], price: 39, sale_price: 31.2,
      search_visible: true, sort_order: index,
      image_variants: { [image]: { mimeType: 'image/svg+xml', variants: {
        thumb: variant('thumb', 320, 480), medium: variant('medium', 640, 960),
        large: variant('master', 1024, 1536), master: variant('master', 1024, 1536),
      } } },
    }
  })
  let storeRequests = 0
  let productRequests = 0
  const requestedImages: string[] = []
  const previewStore = { ...store, name: 'Esimene pood', slug: 'pood-0', settings: {
    ...store.settings, editableStoreName: 'Esimene pood', storeTheme: 'paper', storeAccent: '#cc6633',
    storeLogo: '/images/poeruum-email-logo.svg', storeDescription: 'Poe päris tutvustus.',
    deliverySettings: {
      dispatchTime: { enabled: true, min: 1, max: 2, unit: 'business_days' },
      parcelProviders: { omniva: { enabled: true, price: 3 }, dpd: { enabled: false, price: 0 }, smartposti: { enabled: false, price: 0 } },
      courierEnabled: false, pickupEnabled: false, courierPrice: 0, freeShippingFrom: 0, pickupAddress: '',
    },
    autoSwipeEnabled: false,
  } }
  await page.addInitScript(() => localStorage.setItem('autoSwipeEnabled', 'true'))
  await page.route('**/rest/v1/public_storefronts?*', async (route) => {
    storeRequests += 1
    await json(route, previewStore)
  })
  const catalogProduct = { id: 'lamp', name: 'Lamp', image_url: '/images/kaubamaja-example-ceramics.webp', price: 39 }
  await page.route('**/rest/v1/rpc/storefront_seo_catalog', (route) => json(route, [
    { store_id: 'empty', store_slug: 'empty', store_name: 'Tühi pood', products: [] },
    { store_id: 'sold', store_slug: 'sold', store_name: 'Väljamüüdud pood', products: [{ ...catalogProduct, stock: 0 }] },
    ...['Esimene pood', 'Teine pood', 'Kolmas pood', 'Neljas pood'].map((name, index) => ({
      store_id: index === 0 ? STORE_ID : `store-${index}`, store_slug: `pood-${index}`, store_name: name,
      primary_hostname: index === 0 ? 'esimene.example.ee' : undefined,
      store_logo: '/images/poeruum-email-logo.svg', products: [catalogProduct],
    })),
  ]))
  await page.route('**/rest/v1/products?*', async (route) => {
    productRequests += 1
    expect(new URL(route.request().url()).searchParams.get('store_id')).toBe(`eq.${STORE_ID}`)
    await json(route, products)
  })
  await page.route(`${imageRoot}/**`, async (route) => {
    requestedImages.push(route.request().url())
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="320" height="480" fill="#265f43"/></svg>' })
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const phone = page.frameLocator('.platform-phone__frame')
  await expect(page.locator('.platform-phone')).toHaveAttribute('href', 'https://esimene.example.ee/')
  await expect(phone.locator('.story-brand')).toContainText('ESIMENE POOD')
  await expect(phone.locator('.app-shell')).toHaveAttribute('data-store-theme', 'paper')
  await expect(phone.locator('.product-price .price-value strong')).toHaveText('31.2 €')
  await expect(phone.locator('.product-details__buy')).toHaveCSS('background-color', 'rgb(204, 102, 51)')
  await expect(phone.locator('.product-availability')).toContainText('Saadame 1–2 tööpäevaga')
  await expect(phone.locator('.site-footer')).toContainText('Poe päris tutvustus.')
  await expect(phone.locator('.storefront-product-links')).toHaveCSS('position', 'absolute')
  await expect(page.getByText(/näidispood/i)).toHaveCount(0)
  const previewOrder = await phone.locator('.story-slide > img').evaluateAll((images) =>
    images.slice(1, -1).map((image) => image.getAttribute('alt')!),
  )
  expect([...previewOrder].sort()).toEqual(['lamp', 'tray', 'vase'])
  const firstImage = phone.locator('.story-slide > img').nth(1)
  await expect(firstImage).toHaveAttribute('fetchpriority', 'high')
  await expect.poll(() => firstImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  expect(await firstImage.evaluate((image: HTMLImageElement) => image.currentSrc)).toContain(`/${previewOrder[0]}/medium.svg`)
  expect(requestedImages.some((url) => url.endsWith('/master.svg'))).toBe(false)
  expect(storeRequests).toBe(1)
  expect(productRequests).toBe(1)
  expect(await phone.locator('body').evaluate(() => innerWidth)).toBe(390)
  expect(await page.evaluate(() => localStorage.getItem('autoSwipeEnabled'))).toBe('true')
  const motion = await phone.locator('.story-track').evaluate((track) => new Promise<{
    width: number; samples: Array<{ time: number; x: number; y: number; product: string | null }>
  }>((resolve) => {
    const width = track.clientWidth
    const start = performance.now()
    const samples: Array<{ time: number; x: number; y: number; product: string | null }> = []
    const sample = () => {
      samples.push({
        time: performance.now() - start, x: track.scrollLeft, y: scrollY,
        product: document.querySelector('.product-details h1')?.textContent ?? null,
      })
      if (track.scrollLeft >= 2 * width - 1) resolve({ width, samples })
      else requestAnimationFrame(sample)
    }
    sample()
  }))
  const { width, samples } = motion
  const maximumScroll = Math.max(...samples.map((sample) => sample.y))
  expect(maximumScroll).toBeGreaterThan(0)
  const reading = samples.filter((sample) => sample.y === maximumScroll)
  expect(reading.at(-1)!.time - reading[0].time).toBeGreaterThan(2500)
  const returnedToTop = samples.find((sample, index) => sample.y === 0 && samples[index - 1]?.y > 0)!
  const swipe = samples.filter((sample) => sample.x > width + 1)
  expect(swipe[0].time - returnedToTop.time).toBeGreaterThan(500)
  expect(swipe.every((sample) => sample.y === 0)).toBe(true)
  expect(swipe.some((sample) => sample.x < 2 * width - 1)).toBe(true)
  expect(samples.filter((sample) => sample.x === width).every((sample) => sample.product === previewOrder[0])).toBe(true)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await expect(phone.locator('.product-details h1')).toHaveText(previewOrder[1])
  expect(errors).toEqual([])

  const cards = page.locator('.platform-stores__card')
  await expect(cards).toHaveCount(3)
  await expect(cards.first()).toHaveAttribute('href', 'https://esimene.example.ee/')
  await expect(cards).toHaveText(['Esimene pood', 'Teine pood', 'Kolmas pood'])
  await expect(page.getByRole('link', { name: 'Vaata kõiki poode' })).toHaveAttribute('href', 'https://kaubamaja.poeruum.ee/')
  expect(await page.locator('.platform-stores').evaluate((section) =>
    Boolean(section.compareDocumentPosition(document.getElementById('hind')!) & Node.DOCUMENT_POSITION_FOLLOWING),
  )).toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Ava menüü' }).click()
  await expect(page.locator('.platform-mobile-menu').getByRole('link', { name: 'Kaubamaja' })).toHaveAttribute('href', 'https://kaubamaja.poeruum.ee/')
  await page.getByRole('button', { name: 'Sulge menüü' }).click()
  await cards.first().scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  expect(await page.locator('.platform-stores__grid').evaluate((grid) => grid.scrollWidth > grid.clientWidth)).toBe(true)

  await page.route('https://esimene.example.ee/', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Esimene pood</h1>' }))
  await page.locator('.platform-phone').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('https://esimene.example.ee/')
})

test('homepage omits unavailable stores and keeps signup and Kaubamaja accessible', async ({ page }) => {
  await installSupabaseBackend(page)
  await page.goto('/')
  await expect(page.locator('.platform-hero__copy > button')).toHaveText('Alusta tasuta →')
  await expect(page.locator('.platform-phone')).toHaveCount(0)
  await expect(page.locator('.platform-stores')).toHaveCount(0)
  await expect(page.locator('nav').getByRole('link', { name: 'Kaubamaja' })).toHaveAttribute('href', 'https://kaubamaja.poeruum.ee/')
})

async function installProductHomepage(page: Page, brokenGallery = false, productCount = 1) {
  await installSupabaseBackend(page)
  const imageRoot = 'http://localhost:4174/storage/v1/object/public/product-images/gallery-test'
  const mainImage = `${imageRoot}/main.svg`
  const secondImage = `${imageRoot}/second.svg`
  await page.route('**/rest/v1/public_storefronts?*', (route) => json(route, { ...store, name: 'Krük-Krük', slug: 'kruk-kruk' }))
  await page.route('**/rest/v1/rpc/storefront_seo_catalog', (route) => json(route, [{
    store_id: STORE_ID, store_slug: 'kruk-kruk', store_name: 'Krük-Krük',
    products: [{ id: 'cap', name: 'Nokkmüts', image_url: mainImage, price: 42, stock: 2 }],
  }]))
  await page.route('**/rest/v1/products?*', (route) => json(route, Array.from({ length: productCount }, (_, index) => ({
    id: index ? `cap-${index}` : 'cap', store_id: STORE_ID, name: productCount > 1 ? `Nokkmüts ${index + 1}` : 'Nokkmüts', image_url: mainImage,
    gallery: [mainImage, secondImage], price: 42, stock: 2, search_visible: true,
  }))))
  await page.route(`${imageRoot}/**`, (route) => brokenGallery && route.request().url() === secondImage
    ? route.fulfill({ status: 404, body: 'Missing image' })
    : route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="800"><rect width="390" height="800" fill="${route.request().url() === mainImage ? '#265f43' : '#cc6633'}"/></svg>` }))
}

test('explainer reuses the homepage phone and keeps the real shop preview on refresh', async ({ page }) => {
  await installProductHomepage(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/mis-on-poeruum/')
  const phone = page.locator('.about-poeruum__phone .platform-phone')
  const frame = page.frameLocator('.platform-phone__frame')
  await expect(phone).toHaveAttribute('href', 'https://kruk-kruk.poeruum.ee/')
  await expect(frame.locator('.product-details h1')).toHaveText('Nokkmüts')
  await expect(frame.locator('.product-price .price-value strong')).toHaveText('42 €')
  await expect(frame.locator('.storefront-product-links')).toHaveCSS('position', 'absolute')
  await expect(page.locator('.about-poeruum__sample-order, .about-poeruum__orders-preview')).toHaveCount(0)
  await expect(page.getByText(/näidispood|näidisandmed/i)).toHaveCount(0)
  await frame.locator('html').evaluate((node) => { node.dataset.previewProbe = 'preserved' })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(frame.locator('html')).toHaveAttribute('data-preview-probe', 'preserved')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await phone.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    expect(await frame.locator('body').evaluate(() => innerWidth)).toBe(390)
    expect((await phone.boundingBox())!.width).toBeGreaterThan(200)
  }
  expect(errors).toEqual([])
})

test('homepage shows a second gallery image, resets a single product, and preserves the iframe on focus', async ({ page }) => {
  await installProductHomepage(page)
  await page.clock.install()
  await page.goto('/')
  const phone = page.frameLocator('.platform-phone__frame')
  const thumbnail = phone.locator('.gallery-thumbnails .is-active')
  const image = phone.locator('.story-slide > img').nth(1)
  await expect(image).toHaveJSProperty('complete', true)
  await expect(page.locator('.platform-phone__frame')).toHaveAttribute('data-preview-visible', 'true')
  await expect(thumbnail).toHaveAttribute('aria-label', 'Pilt 1')
  await page.clock.runFor(4500)
  await expect(thumbnail).toHaveAttribute('aria-label', 'Pilt 2')
  await expect(image).toHaveAttribute('src', /second.svg$/)
  expect(await image.evaluate(() => scrollY)).toBe(0)
  await image.evaluate(() => { document.documentElement.dataset.focusProbe = 'preserved' })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(phone.locator('html')).toHaveAttribute('data-focus-probe', 'preserved')
  await page.clock.runFor(3000)
  await expect(thumbnail).toHaveAttribute('aria-label', 'Pilt 1')
  await expect(image).toHaveAttribute('src', /main.svg$/)
})

test('homepage animation pauses offscreen and respects reduced motion', async ({ page }) => {
  await installProductHomepage(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  await page.goto('/')
  const phone = page.frameLocator('.platform-phone__frame')
  const thumbnail = phone.locator('.gallery-thumbnails .is-active')
  await expect(thumbnail).toHaveAttribute('aria-label', 'Pilt 1')
  await page.clock.runFor(9000)
  await expect(thumbnail).toHaveAttribute('aria-label', 'Pilt 1')
  await page.locator('#hind').scrollIntoViewIfNeeded()
  await expect(page.locator('.platform-phone__frame')).toHaveAttribute('data-preview-visible', 'false')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.clock.runFor(9000)
  await expect(thumbnail).toHaveAttribute('aria-label', 'Pilt 1')
  await page.locator('.platform-phone').scrollIntoViewIfNeeded()
  await expect(page.locator('.platform-phone__frame')).toHaveAttribute('data-preview-visible', 'true')
  await page.clock.runFor(4500)
  await expect(thumbnail).toHaveAttribute('aria-label', 'Pilt 2')
})

test('homepage skips a broken gallery image and continues its description tour', async ({ page }) => {
  await installProductHomepage(page, true)
  await page.goto('/')
  const phone = page.frameLocator('.platform-phone__frame')
  await expect(phone.locator('.gallery-thumbnails .is-active')).toHaveAttribute('aria-label', 'Pilt 1')
  await expect.poll(() => phone.locator('body').evaluate(() => scrollY), { timeout: 10000 }).toBeGreaterThan(0)
  await expect(phone.locator('.story-slide > img').nth(1)).toHaveAttribute('src', /main.svg$/)
})

test('homepage demonstrates typing and opening a real search result for more than ten products', async ({ page }) => {
  await installProductHomepage(page, false, 11)
  await page.clock.install()
  await page.goto('/')
  const phone = page.frameLocator('.platform-phone__frame')
  await expect(phone.locator('.story-slide > img').nth(1)).toHaveJSProperty('complete', true)
  // Keep time fixed between runFor calls: browser round trips must not type
  // another letter while the test changes the reduced-motion preference.
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100))
  const products = await phone.locator('#storefront-preview-data').textContent()
  const target = JSON.parse(products!).products[1].name
  await page.locator('.platform-hero__copy > button').focus()
  await page.clock.runFor(4200)
  const query = phone.getByPlaceholder('Mida sa otsid?')
  await expect(query).toBeVisible()
  await page.clock.runFor(700)
  const partialQuery = await query.inputValue()
  expect(partialQuery.length).toBeGreaterThan(0)
  expect(partialQuery.length).toBeLessThan(target.length)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.runFor(5000)
  await expect(query).toHaveValue(partialQuery)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.clock.runFor(1500)
  await expect(query).toHaveValue(target)
  await expect(phone.locator('.search-results')).toContainText(target)
  await page.screenshot({ path: 'output/homepage-search-demo.png' })
  await page.clock.runFor(2200)
  await expect(query).toHaveCount(0)
  await expect(phone.locator('.product-details h1')).toHaveText(target)
  await expect(page.locator('.platform-hero__copy > button')).toBeFocused()
  expect(await page.evaluate(() => scrollY)).toBe(0)
  // Search is occasional: the next product keeps its ordinary gallery/details tour.
  await page.clock.runFor(4200)
  await expect(query).toHaveCount(0)
})

test('homepage keeps the normal product tour at the ten-product boundary', async ({ page }) => {
  await installProductHomepage(page, false, 10)
  await page.clock.install()
  await page.goto('/')
  const phone = page.frameLocator('.platform-phone__frame')
  await expect(phone.locator('.story-slide > img').nth(1)).toHaveJSProperty('complete', true)
  await page.clock.runFor(6500)
  await expect(phone.getByPlaceholder('Mida sa otsid?')).toHaveCount(0)
})

test('merchant downloads readable branded QR artwork for the active shop domain', async ({ page }, testInfo) => {
  await installSupabaseBackend(page, { ...store, settings: { ...store.settings, storeLogo: '/images/poeruum-email-logo.svg' } })
  await page.route('**/functions/v1/custom-domain', (route) => json(route, {
    domain: { id: 'domain-1', hostname: 'keraamika.example.ee', status: 'active' },
  }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await page.getByRole('button', { name: 'Seaded', exact: true }).click()
  await expect(page.locator('.settings-store-address strong')).toHaveText('keraamika.example.ee')
  await expect(page.locator('.settings-store-address button')).toHaveCount(1)
  const opener = page.locator('.settings-home button[data-section="qr"]')
  await expect(opener).toContainText('QR-kood')
  await opener.click()
  const qr = page.getByRole('dialog', { name: 'Poe QR-kood', exact: true })
  await expect(qr.getByLabel('Poe logoga')).toBeChecked()
  await expect(qr.getByRole('button', { name: 'Ring', exact: true })).toHaveAttribute('aria-pressed', 'true')
  for (const shape of ['round', 'square']) {
    await qr.getByRole('button', { name: shape === 'round' ? 'Ring' : 'Ruut', exact: true }).click()
    const pngButton = qr.getByRole('button', { name: /Laadi PNG alla/ })
    await expect(pngButton).toBeEnabled()
    const pngDownload = page.waitForEvent('download')
    await pngButton.click()
    const png = await pngDownload
    expect(png.suggestedFilename()).toMatch(new RegExp(`-qr-${shape === 'round' ? 'kleeps' : 'ruut'}\\.png$`))
    const pngPath = testInfo.outputPath(`${shape}.png`)
    await png.saveAs(pngPath)
    const artwork = PNG.sync.read(await readFile(pngPath))
    expect([artwork.width, artwork.height]).toEqual([2000, 2000])
    let logoPixels = 0
    for (let index = 0; index < artwork.data.length; index += 4) {
      const alpha = artwork.data[index + 3] / 255
      for (let channel = 0; channel < 3; channel++) artwork.data[index + channel] = artwork.data[index + channel] * alpha + 255 * (1 - alpha)
      if (artwork.data[index + 1] > artwork.data[index] + 20) logoPixels++
    }
    expect(logoPixels).toBeGreaterThan(1000)
    if (shape === 'round') {
      // The artwork should fill every side of the circle, not leave a small
      // square QR surrounded by an otherwise empty circular sticker.
      for (const [cx, cy] of [[.5, .1], [.9, .5], [.5, .9], [.1, .5]]) {
        let darkPixels = 0
        for (let dy = -50; dy <= 50; dy += 5) {
          for (let dx = -50; dx <= 50; dx += 5) {
            const index = ((cy * artwork.height + dy) * artwork.width + cx * artwork.width + dx) * 4
            if (artwork.data[index] < 32 && artwork.data[index + 1] < 32 && artwork.data[index + 2] < 32) darkPixels++
          }
        }
        expect(darkPixels).toBeGreaterThan(60)
      }
    }
    expect(jsQR(new Uint8ClampedArray(artwork.data), artwork.width, artwork.height)?.data).toBe('https://keraamika.example.ee')
    const pdfDownload = page.waitForEvent('download')
    await qr.getByRole('button', { name: /Laadi PDF alla/ }).click()
    const pdfPath = testInfo.outputPath(`${shape}.pdf`)
    await (await pdfDownload).saveAs(pdfPath)
    const pdf = await PDFDocument.load(await readFile(pdfPath))
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(50 * 72 / 25.4)
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(50 * 72 / 25.4)
    await qr.screenshot({ path: testInfo.outputPath(`${shape}-dialog.png`) })
  }
  await page.keyboard.press('Escape')
  await expect(qr).toHaveCount(0)
  await expect(opener).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.getByRole('dialog', { name: 'Seaded', exact: true }).screenshot({ path: testInfo.outputPath('settings-qr-card.png') })
})

test('merchant QR supports light patterns on dark backgrounds in both export shapes', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  await installSupabaseBackend(page, { ...store, slug: 'urgits', settings: { ...store.settings, storeLogo: '/images/poeruum-email-logo.svg' } })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await page.getByRole('button', { name: 'Seaded', exact: true }).click()
  await page.locator('.settings-home button[data-section="qr"]').click()
  const qr = page.getByRole('dialog', { name: 'Poe QR-kood', exact: true })
  const pngButton = qr.getByRole('button', { name: /Laadi PNG alla/ })
  await expect(pngButton).toBeEnabled()
  await qr.getByLabel('Koodi värv', { exact: true }).fill('#ffffff')
  await qr.getByLabel('Tausta värv', { exact: true }).fill('#000000')
  for (const shape of ['Ring', 'Ruut']) {
    await qr.getByRole('button', { name: shape, exact: true }).click()
    for (const pattern of ['Ruudud', 'Ümarad', 'Täpid']) {
      await qr.getByRole('button', { name: pattern, exact: true }).click()
      await expect(pngButton).toBeEnabled()
      await expect(qr.getByRole('alert')).toHaveCount(0)
      const pngDownload = page.waitForEvent('download')
      await pngButton.click()
      const path = testInfo.outputPath(`inverted-${shape}-${pattern}.png`)
      await (await pngDownload).saveAs(path)
      const artwork = PNG.sync.read(await readFile(path))
      // Flatten transparent round corners onto the white printed page.
      for (let i = 0; i < artwork.data.length; i += 4) {
        const alpha = artwork.data[i + 3] / 255
        for (let channel = 0; channel < 3; channel++) artwork.data[i + channel] = artwork.data[i + channel] * alpha + 255 * (1 - alpha)
      }
      expect(jsQR(new Uint8ClampedArray(artwork.data), artwork.width, artwork.height)?.data).toBe('https://urgits.poeruum.ee')
      const pdfDownload = page.waitForEvent('download')
      await qr.getByRole('button', { name: /Laadi PDF alla/ }).click()
      await (await pdfDownload).saveAs(testInfo.outputPath(`inverted-${shape}-${pattern}.pdf`))
      if (shape === 'Ring' && pattern === 'Täpid') await qr.screenshot({ path: testInfo.outputPath('inverted-round-dots.png') })
    }
  }
  await qr.getByLabel('Koodi värv', { exact: true }).fill('#f4edda')
  await qr.getByLabel('Tausta värv', { exact: true }).fill('#173d2b')
  await expect(pngButton).toBeEnabled()
  await expect(qr.getByRole('alert')).toHaveCount(0)
})

test('merchant customizes QR colors, patterns and logo size with readable matching exports', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  await installSupabaseBackend(page, { ...store, settings: { ...store.settings, storeLogo: '/images/poeruum-email-logo.svg', storeAccent: '#265f43' } })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await page.getByRole('button', { name: 'Seaded', exact: true }).click()
  await page.locator('.settings-home button[data-section="qr"]').click()
  const qr = page.getByRole('dialog', { name: 'Poe QR-kood', exact: true })
  const pngButton = qr.getByRole('button', { name: /Laadi PNG alla/ })
  await expect(pngButton).toBeEnabled()
  await qr.getByRole('button', { name: 'Poe värvid', exact: true }).click()
  await expect(qr.getByLabel('Koodi värv', { exact: true })).toHaveValue('#265f43')
  await expect(qr.getByLabel('Tausta värv', { exact: true })).toHaveValue('#ffffff')
  await expect(pngButton).toBeEnabled()

  const logoPixelCounts: number[] = []
  for (const shape of ['Ring', 'Ruut']) {
    await qr.getByRole('button', { name: shape, exact: true }).click()
    for (const [pattern, size] of [['Ruudud', 'Väike'], ['Ümarad', 'Keskmine'], ['Täpid', 'Suur']]) {
      await qr.getByRole('button', { name: pattern, exact: true }).click()
      await qr.getByRole('button', { name: size, exact: true }).click()
      await qr.getByLabel('Koodi värv', { exact: true }).fill('#173d2b')
      await qr.getByLabel('Tausta värv', { exact: true }).fill('#f4edda')
      await expect(pngButton).toBeEnabled()
      await expect(qr.getByRole('alert')).toHaveCount(0)
      const filename = `${shape}-${pattern}-${size}`
      const pngDownload = page.waitForEvent('download')
      await pngButton.click()
      const path = testInfo.outputPath(`${filename}.png`)
      await (await pngDownload).saveAs(path)
      const artwork = PNG.sync.read(await readFile(path))
      const countColor = (r: number, g: number, b: number) => {
        let count = 0
        for (let i = 0; i < artwork.data.length; i += 4) {
          if (artwork.data[i] === r && artwork.data[i + 1] === g && artwork.data[i + 2] === b && artwork.data[i + 3] === 255) count++
        }
        return count
      }
      expect(countColor(23, 61, 43)).toBeGreaterThan(100000)
      expect(countColor(244, 237, 218)).toBeGreaterThan(100000)
      // The store logo's lime pixels must grow with the chosen size.
      logoPixelCounts.push(countColor(229, 242, 90))
      for (let i = 0; i < artwork.data.length; i += 4) {
        const alpha = artwork.data[i + 3] / 255
        for (let channel = 0; channel < 3; channel++) artwork.data[i + channel] = artwork.data[i + channel] * alpha + 255 * (1 - alpha)
      }
      expect(jsQR(new Uint8ClampedArray(artwork.data), artwork.width, artwork.height)?.data).toBe('https://sisselogimise-testipood.poeruum.ee')
      const pdfDownload = page.waitForEvent('download')
      await qr.getByRole('button', { name: /Laadi PDF alla/ }).click()
      await (await pdfDownload).saveAs(testInfo.outputPath(`${filename}.pdf`))
    }
  }
  expect(logoPixelCounts[0]).toBeGreaterThan(0)
  expect(logoPixelCounts[1]).toBeGreaterThan(logoPixelCounts[0])
  expect(logoPixelCounts[2]).toBeGreaterThan(logoPixelCounts[1])
  expect(logoPixelCounts[4]).toBeGreaterThan(logoPixelCounts[3])
  expect(logoPixelCounts[5]).toBeGreaterThan(logoPixelCounts[4])
  await qr.screenshot({ path: testInfo.outputPath('custom-desktop.png') })

  for (const [foreground, background] of [['#2321a6', '#b18686'], ['#eeeeee', '#ffffff'], ['#ffffff', '#eeeeee']]) {
    await qr.getByLabel('Koodi värv', { exact: true }).fill(foreground)
    await qr.getByLabel('Tausta värv', { exact: true }).fill(background)
    await expect(qr.getByRole('alert')).toContainText('Liiga väike kontrast')
    await expect(pngButton).toBeDisabled()
    await expect(qr.getByRole('button', { name: /Laadi PDF alla/ })).toBeDisabled()
    await expect(qr.locator('.store-qr__preview')).toHaveAttribute('aria-busy', 'false')
    const preview = qr.locator('.store-qr__preview img')
    await expect(preview).toBeVisible()
    const pixels = PNG.sync.read(Buffer.from((await preview.getAttribute('src'))!.split(',')[1], 'base64')).data
    // Even rejected colors must be rendered, rather than showing a stale image.
    for (const color of [foreground, background]) {
      const [r, g, b] = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16))
      expect(pixels.some((value, index) => index % 4 === 0 && value === r && pixels[index + 1] === g && pixels[index + 2] === b && pixels[index + 3] === 255)).toBe(true)
    }
    const warning = await qr.getByRole('alert').boundingBox()
    const colorInput = await qr.getByLabel('Koodi värv', { exact: true }).boundingBox()
    expect(warning!.y + warning!.height).toBeLessThan(colorInput!.y)
    if (foreground === '#2321a6') await qr.screenshot({ path: testInfo.outputPath('low-contrast-preview.png') })
  }
  await qr.getByRole('button', { name: 'Lähtesta', exact: true }).click()
  await expect(pngButton).toBeEnabled()
  await expect(qr.getByRole('button', { name: 'Ruudud', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(qr.getByRole('button', { name: 'Keskmine', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(qr.getByLabel('Koodi värv', { exact: true })).toHaveValue('#000000')
  await qr.getByLabel('Poe logoga').uncheck()
  await expect(qr.getByRole('button', { name: 'Suur', exact: true })).toBeDisabled()
  await expect(pngButton).toBeEnabled()
  await page.setViewportSize({ width: 320, height: 740 })
  expect(await qr.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await pngButton.scrollIntoViewIfNeeded()
  await expect(pngButton).toBeVisible()
  await qr.screenshot({ path: testInfo.outputPath('custom-mobile.png') })
})

for (const missingLogo of [false, true]) {
  test(`merchant QR works ${missingLogo ? 'without a store logo' : 'after a logo fails to load'}`, async ({ page }) => {
    await installSupabaseBackend(page, { ...store, settings: { ...store.settings, storeLogo: missingLogo ? null : '/missing-qr-logo.svg' } })
    await page.route('**/missing-qr-logo.svg', (route) => route.fulfill({ status: 404, body: '' }))
    await page.goto('/?continue_setup=1')
    await page.getByLabel('E-posti aadress').fill(user.email)
    await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
    await page.getByRole('button', { name: /Jätka oma poega/ }).click()
    await page.getByRole('button', { name: 'Seaded', exact: true }).click()
    await page.locator('.settings-home button[data-section="qr"]').click()
    const qr = page.getByRole('dialog', { name: 'Poe QR-kood', exact: true })
    await expect(qr.locator('header p')).toHaveText('sisselogimise-testipood.poeruum.ee')
    if (!missingLogo) {
      await expect(qr.getByRole('alert')).toContainText('Logo laadimine ebaõnnestus')
      await expect(qr.getByRole('button', { name: /Laadi PNG alla/ })).toBeDisabled()
      await qr.getByLabel('Poe logoga').uncheck()
    }
    await expect(qr.getByRole('button', { name: /Laadi PNG alla/ })).toBeEnabled()
    await expect(qr.getByRole('alert')).toHaveCount(0)
    if (missingLogo) {
      await qr.getByRole('button', { name: 'Poe värvid', exact: true }).click()
      await expect(qr.getByLabel('Koodi värv', { exact: true })).toHaveValue('#000000')
      await expect(qr.getByLabel('Tausta värv', { exact: true })).toHaveValue('#e5f25a')
      await qr.getByRole('button', { name: 'Täpid', exact: true }).click()
      await expect(qr.getByRole('button', { name: /Laadi PNG alla/ })).toBeEnabled()
      await expect(qr.getByRole('alert')).toHaveCount(0)
    }
    await qr.getByRole('button', { name: 'Sulge', exact: true }).click()
    await expect(qr).toHaveCount(0)
  })
}

const encodeJwtPart = (value: Record<string, unknown>) => Buffer
  .from(JSON.stringify(value))
  .toString('base64url')

const accessToken = [
  encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
  encodeJwtPart({
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: USER_ID,
    email: 'kaupmees@example.com',
    role: 'authenticated',
  }),
  'playwright-signature',
].join('.')

const user = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'kaupmees@example.com',
  email_confirmed_at: '2026-08-01T08:00:00.000Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-08-01T08:00:00.000Z',
  updated_at: '2026-08-01T08:00:00.000Z',
}

const store = {
  id: STORE_ID,
  owner_id: USER_ID,
  name: 'Sisselogimise testipood',
  slug: 'sisselogimise-testipood',
  is_published: true,
  payment_provider: 'stripe',
  payment_status: 'connected',
  stripe_account_id: 'acct_playwright',
  stripe_account_charges_enabled: true,
  stripe_account_payouts_enabled: true,
  stripe_account_requirements_due_count: 1,
  stripe_account_requirements_past_due: false,
  stripe_account_requirements_deadline: '2026-10-09T00:00:00.000Z',
  stripe_account_requirements_pending_verification: false,
  stripe_account_requirements_disabled_reason: null,
  stripe_account_requirement_issues: [],
  stripe_account_requirements_updated_at: '2026-08-26T06:00:00.000Z',
  stripe_customer_id: null,
  stripe_subscription_id: null,
  stripe_subscription_status: null,
  pricing_plan: 'flexible',
  trial_started_at: null,
  billing_delinquent_at: null,
  billing_grace_ends_at: null,
  billing_last_failed_invoice_id: null,
  billing_last_failed_invoice_url: null,
  billing_downgraded_at: null,
  shipping: ['omniva'],
  settings: {
    onboardingStep: 'complete',
    editableStoreName: 'Sisselogimise testipood',
    businessName: 'Testikaupmees OÜ',
    registryCode: '12345678',
    businessAddress: 'Testi 1, Tallinn',
    contactEmail: 'kaupmees@example.com',
  },
}

const connectedStripeStatus = {
  status: 'connected',
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  requirements: {
    dueCount: 1,
    pastDue: false,
    currentDeadline: '2026-10-09T00:00:00.000Z',
    pendingVerification: false,
    disabledReason: null,
    issues: [],
  },
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  headers: { 'Access-Control-Allow-Origin': '*' },
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const installSupabaseBackend = async (
  page: Page,
  storeFixture: Record<string, unknown> = store,
  stripeStatusFixture: Record<string, unknown> = connectedStripeStatus,
  options: { temporaryEmail?: boolean; unconfirmedEmail?: boolean; beforeProductsResponse?: () => Promise<void>; publicStore?: typeof store;
    products?: Record<string, unknown>[]; getOrders?: () => Record<string, unknown>[]; refundOrder?: () => Record<string, unknown> } = {},
) => {
  let passwordSignIns = 0
  let sessionRefreshes = 0
  let currentPassword: string | null = null
  const passwordUpdates: string[] = []
  const passwordResetRedirects: string[] = []
  const signOutScopes: string[] = []
  const accountEmail = { email: options.temporaryEmail ? 'trial@minitts.net' : user.email, pending_email: null as string | null, email_confirmed: !options.unconfirmedEmail, is_disposable: Boolean(options.temporaryEmail), activation_allowed: !options.temporaryEmail && !options.unconfirmedEmail }
  const emailUpdates: string[] = []
  const confirmationRequests: Array<{ type: string; email: string }> = []
  let emailStatusUnavailable = false
  let currentStore = { ...storeFixture }
  let currentProducts = structuredClone(options.products ?? [])

  await page.route('**/storage/v1/object/public/product-images/auth-preview.svg', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#226748"/></svg>' }))

  await page.route('**/__e2e_supabase/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      } })
      return
    }

    if (url.pathname.endsWith('/rest/v1/rpc/resolve_store_slug_for_hostname')) {
      await json(route, options.publicStore?.slug ?? null)
      return
    }

    if (url.pathname.endsWith('/rest/v1/public_storefronts')) {
      await json(route, url.searchParams.get('slug') === `eq.${options.publicStore?.slug}` ? options.publicStore : null)
      return
    }

    if (url.pathname.endsWith('/auth/v1/token')) {
      const grantType = url.searchParams.get('grant_type')
      if (grantType === 'password') {
        passwordSignIns += 1
        if (currentPassword && request.postDataJSON().password !== currentPassword) {
          await json(route, { code: 'invalid_credentials', message: 'Invalid login credentials' }, 400)
          return
        }
      }
      else if (grantType === 'refresh_token') sessionRefreshes += 1
      else {
        await json(route, { message: 'Unsupported test grant type' }, 400)
        return
      }
      await json(route, {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'playwright-refresh-token',
        user,
      })
      return
    }

    if (url.pathname.endsWith('/auth/v1/user')) {
      if (request.method() === 'PUT') {
        if (request.postDataJSON().password) {
          currentPassword = request.postDataJSON().password
          passwordUpdates.push(currentPassword!)
        }
        if (request.postDataJSON().email) {
          accountEmail.pending_email = request.postDataJSON().email
          emailUpdates.push(accountEmail.pending_email!)
        }
      }
      await json(route, user)
      return
    }

    if (url.pathname.endsWith('/auth/v1/resend')) {
      confirmationRequests.push(request.postDataJSON())
      await json(route, {})
      return
    }

    if (url.pathname.endsWith('/auth/v1/recover')) {
      passwordResetRedirects.push(url.searchParams.get('redirect_to') ?? '')
      await json(route, {})
      return
    }

    if (url.pathname.endsWith('/auth/v1/logout')) {
      signOutScopes.push(url.searchParams.get('scope') ?? '')
      await json(route, {})
      return
    }

    if (url.pathname.endsWith('/rest/v1/stores')) {
      if (request.method() === 'PATCH') {
        currentStore = { ...currentStore, ...request.postDataJSON() as Record<string, unknown> }
        await json(route, currentStore)
        return
      }
      const isOwnedStoreRequest = url.searchParams.get('owner_id') === `eq.${USER_ID}`
      if (isOwnedStoreRequest) await json(route, [currentStore])
      else await json(route, [])
      return
    }

    if (url.pathname.endsWith('/rest/v1/products')) {
      if (request.method() === 'POST') {
        const product = request.postDataJSON() as Record<string, unknown>
        currentProducts = [...currentProducts.filter((item) => item.id !== product.id), product]
        await json(route, product)
        return
      }
      if (options.publicStore && url.searchParams.get('store_id') === `eq.${options.publicStore.id}`) {
        await json(route, options.products ? currentProducts : [{
          id: '30000000-0000-4000-8000-000000000001', store_id: options.publicStore.id,
          name: 'Teise poe toode', slug: 'teise-poe-toode', price: 19, stock: 3, search_visible: true,
          image_url: 'http://localhost:4174/storage/v1/object/public/product-images/auth-preview.svg',
        }])
        return
      }
      await options.beforeProductsResponse?.()
      await json(route, currentProducts)
      return
    }

    if (url.pathname.endsWith('/functions/v1/stripe-connect')) {
      await json(route, stripeStatusFixture)
      return
    }
    if (url.pathname.endsWith('/functions/v1/platform-invoices')) {
      await json(route, { documents: [], hasMore: false })
      return
    }

    if (url.pathname.endsWith('/rest/v1/orders')) {
      await json(route, options.getOrders?.() ?? [])
      return
    }
    if (url.pathname.endsWith('/functions/v1/stripe-refund-order')) {
      await json(route, options.refundOrder?.() ?? { error: 'Unexpected test refund' })
      return
    }

    if (url.pathname.endsWith('/rest/v1/rpc/account_email_status')) {
      if (emailStatusUnavailable) { await json(route, { message: 'Temporary test outage' }, 503); return }
      await json(route, { ...accountEmail, candidate_is_disposable: /@(minitts\.net|tozya\.com)$/i.test(request.postDataJSON()?.candidate_email ?? '') })
      return
    }

    if (url.pathname.includes('/rest/v1/rpc/')) {
      await json(route, null)
      return
    }

    if (url.pathname.endsWith('/rest/v1/platform_settings')) {
      await json(route, { homepage_store_ids: [STORE_ID] })
      return
    }

    await json(route, [])
  })

  return {
    emailUpdates,
    confirmationRequests,
    setEmailStatusUnavailable: (unavailable: boolean) => { emailStatusUnavailable = unavailable },
    confirmEmail: () => { accountEmail.email = accountEmail.pending_email ?? accountEmail.email; accountEmail.pending_email = null; accountEmail.email_confirmed = true; accountEmail.is_disposable = false; accountEmail.activation_allowed = true },
    currentStore: () => currentStore,
    currentProducts: () => currentProducts,
    passwordSignIns: () => passwordSignIns,
    sessionRefreshes: () => sessionRefreshes,
    passwordUpdates,
    passwordResetRedirects,
    signOutScopes,
  }
}

const otherStore = {
  ...store,
  id: '10000000-0000-4000-8000-000000000002',
  owner_id: '20000000-0000-4000-8000-000000000002',
  name: 'Krük-Krük',
  slug: 'kruk-kruk',
  settings: { ...store.settings, editableStoreName: 'Krük-Krük', businessName: 'Teine kaupmees OÜ' },
}

const recoveryFragment = new URLSearchParams({
  access_token: accessToken,
  refresh_token: 'playwright-refresh-token',
  expires_in: '3600',
  token_type: 'bearer',
  type: 'recovery',
}).toString()

test('password recovery survives Supabase consuming the link before the login view loads', async ({ page }) => {
  await installSupabaseBackend(page)
  let releaseView!: () => void
  const viewReady = new Promise<void>((resolve) => { releaseView = resolve })
  await page.route('**/src/PlatformApp.tsx', async (route) => {
    await viewReady
    await route.continue()
  })
  try {
    await page.goto(`/#${recoveryFragment}`, { waitUntil: 'commit' })
    // The real SDK processes the recovery session while the lazy view is pending.
    await page.waitForFunction(() => window.location.hash === '')
  } finally {
    releaseView()
  }
  await expect(page.getByRole('heading', { name: 'Vali uus parool', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Seaded/ })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Vali uus parool', exact: true })).toBeVisible()
})

test('password recovery sends a dedicated link, saves the new password and requires a fresh login', async ({ page }) => {
  const backend = await installSupabaseBackend(page)
  await page.goto('/?continue_setup=1')
  await page.getByRole('button', { name: 'Unustasid parooli?' }).click()
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByRole('button', { name: /Saada taastamislink/ }).click()
  await expect(page.getByRole('status')).toHaveText('Taastamislink on saadetud. Kontrolli oma e-posti.')
  expect(backend.passwordResetRedirects).toEqual(['http://poeruum.localhost:4174/?reset_password=1'])

  await page.goto(`${backend.passwordResetRedirects[0]}#${recoveryFragment}`)
  await expect(page.getByText(`Konto: ${user.email}`, { exact: true })).toBeVisible()
  expect(backend.passwordUpdates).toEqual([])
  const newPassword = 'Uus-testiparool-123!'
  await page.getByLabel('Uus parool', { exact: true }).fill(newPassword)
  await page.getByLabel('Korda uut parooli', { exact: true }).fill('Erinev-parool-123!')
  await page.getByRole('button', { name: /Salvesta uus parool/ }).click()
  await expect(page.getByRole('alert')).toHaveText('Paroolid ei ühti.')
  expect(backend.passwordUpdates).toEqual([])
  await page.getByLabel('Korda uut parooli', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: /Salvesta uus parool/ }).click()
  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Parool on muudetud. Logi nüüd uue parooliga sisse.')
  expect(backend.passwordUpdates).toEqual([newPassword])
  expect(backend.signOutScopes).toEqual(['global'])
  await expect(page).toHaveURL('http://poeruum.localhost:4174/')

  await page.getByLabel('Parool', { exact: true }).fill('Vana-testiparool-123!')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByLabel('Parool', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
})

for (const callback of [
  '/?reset_password=1',
  '/?reset_password=1#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
]) {
  test(`password recovery rejects a missing or expired link: ${callback}`, async ({ page }) => {
    const backend = await installSupabaseBackend(page)
    await page.goto(callback)
    await expect(page.getByRole('alert')).toHaveText('Taastamislink on aegunud või vigane. Palun telli uus taastamislink.')
    await expect(page.getByRole('button', { name: /Salvesta uus parool/ })).toBeDisabled()
    expect(backend.passwordUpdates).toEqual([])
    await page.getByRole('button', { name: 'Telli uus taastamislink' }).click()
    await expect(page.getByRole('heading', { name: 'Unustasid parooli?', exact: true })).toBeVisible()
    await page.getByLabel('E-posti aadress').fill(user.email)
    await page.getByRole('button', { name: /Saada taastamislink/ }).click()
    await expect(page.getByRole('status')).toHaveText('Taastamislink on saadetud. Kontrolli oma e-posti.')
    expect(backend.passwordResetRedirects).toEqual(['http://poeruum.localhost:4174/?reset_password=1'])
  })
}

test('password recovery on an old shop link takes priority over the public storefront and can be cancelled', async ({ page }) => {
  const backend = await installSupabaseBackend(page, store, connectedStripeStatus, { publicStore: otherStore })
  await page.goto(`http://kruk-kruk.poeruum.localhost:4174/#${recoveryFragment}`)
  await expect(page.getByRole('button', { name: /Salvesta uus parool/ })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Teise poe toode', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Tagasi eelmisele lehele' }).click()
  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
  expect(backend.passwordUpdates).toEqual([])
  expect(backend.signOutScopes).toEqual(['local'])
  await page.goto('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
  await expect(page).toHaveURL('http://poeruum.localhost:4174/?continue_setup=1')
  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
})

test('password recovery does not accept an expired link just because the browser is already signed in', async ({ page }) => {
  await installSupabaseBackend(page)
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await page.goto('/?reset_password=1#error=access_denied&error_code=otp_expired')
  await expect(page.getByRole('alert')).toHaveText('Taastamislink on aegunud või vigane. Palun telli uus taastamislink.')
  await expect(page.getByRole('button', { name: /Salvesta uus parool/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Telli uus taastamislink' })).toBeVisible()
})

test('password recovery preserves the form when saving the password fails', async ({ page }) => {
  const backend = await installSupabaseBackend(page)
  await page.route('**/__e2e_supabase/auth/v1/user', async (route) => {
    if (route.request().method() === 'PUT') await json(route, { message: 'Parooli salvestamine ebaõnnestus.' }, 500)
    else await route.fallback()
  })
  await page.goto(`/?reset_password=1#${recoveryFragment}`)
  await page.getByLabel('Uus parool', { exact: true }).fill('Uus-testiparool-123!')
  await page.getByLabel('Korda uut parooli', { exact: true }).fill('Uus-testiparool-123!')
  await page.getByRole('button', { name: /Salvesta uus parool/ }).click()
  await expect(page.getByRole('alert')).toHaveText('Parooli muutmine ebaõnnestus.')
  await expect(page.getByRole('heading', { name: 'Vali uus parool', exact: true })).toBeVisible()
  expect(backend.passwordUpdates).toEqual([])
  expect(backend.signOutScopes).toEqual([])
  await page.reload()
  await expect(page.getByRole('button', { name: /Salvesta uus parool/ })).toBeEnabled()
})

test('product description paragraphs survive editing, saving and customer reloads', async ({ page, browser }) => {
  const original = 'Algne esimene lõik.\n\nAlgne teine lõik.\n\nAlgne kolmas lõik.'
  const backend = await installSupabaseBackend(page, store, connectedStripeStatus, {
    products: [{ id: 'paragraph-product', store_id: STORE_ID, name: 'Taldrik', slug: 'taldrik', description: original,
      price: 29, stock: 1, image_url: 'http://localhost:4174/storage/v1/object/public/product-images/auth-preview.svg' }],
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  const description = page.locator('.product-description')
  await expect(description).toHaveCSS('white-space', 'pre-wrap')
  await expect(description).toHaveText(original, { useInnerText: true })
  await page.getByRole('button', { name: 'Muuda toodet', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Toote kirjeldus', exact: true })
  await editor.click()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(original)
  await editor.fill('Esimene lõik.')
  await editor.press('Enter')
  await editor.press('Enter')
  await editor.pressSequentially('Teine lõik.')
  await editor.press('Shift+Enter')
  await editor.pressSequentially('Teise lõigu uus rida.')
  await editor.press('Enter')
  await editor.press('Enter')
  await editor.pressSequentially('Kolmas lõik.')
  const expected = 'Esimene lõik.\n\nTeine lõik.\nTeise lõigu uus rida.\n\nKolmas lõik.'
  await page.getByRole('button', { name: 'Salvesta muudatused', exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect(backend.currentProducts()[0].description).toBe(expected)
  expect(await description.innerText()).toBe(expected)
  await page.reload()
  await expect(description).toHaveText(expected, { useInnerText: true })

  const customer = await browser.newPage({ viewport: { width: 390, height: 844 } })
  try {
    await installSupabaseBackend(customer, store, connectedStripeStatus, { publicStore: store, products: backend.currentProducts() })
    await customer.goto(`http://${store.slug}.poeruum.localhost:4174/toode/taldrik/`)
    const published = customer.locator('.product-description')
    await expect(published).toHaveCSS('white-space', 'pre-wrap')
    expect(await published.innerText()).toBe(expected)
    await customer.reload()
    await expect(published).toHaveText(expected, { useInnerText: true })
  } finally {
    await customer.close()
  }
})

test('a merchant configures a dispatch range without an unconfirmed default promise', async ({ page, browser }) => {
  const deliverySettings = {
    parcelProviders: { omniva: { enabled: true, price: 3 }, dpd: { enabled: false, price: 3 }, smartposti: { enabled: false, price: 3 } },
    courierEnabled: false, courierPrice: 5, pickupEnabled: false, pickupAddress: '', freeShippingFrom: 50,
  }
  const products = [2, null, 0].map((stock, index) => ({
    id: `dispatch-product-${index}`, store_id: STORE_ID, name: `Testtoode ${index}`, slug: `testtoode-${index}`, price: 20,
    stock, image_url: 'http://localhost:4174/storage/v1/object/public/product-images/auth-preview.svg',
  }))
  const backend = await installSupabaseBackend(page, { ...store, settings: { ...store.settings, deliverySettings } }, connectedStripeStatus, { products })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.locator('.product-availability strong')).toHaveText('Laos olemas')
  await expect(page.locator('.product-availability small')).toHaveCount(0)
  await page.getByRole('button', { name: 'Toode 2', exact: true }).click()
  await expect(page.locator('.product-availability')).toHaveCount(0)
  await page.getByRole('button', { name: 'Toode 1', exact: true }).click()
  await page.getByRole('button', { name: /Seaded/ }).click()
  await page.locator('.settings-home button[data-section="delivery"]').click()
  const showDispatchTime = page.getByRole('checkbox', { name: /^Näita väljasaatmise aega/ })
  await expect(showDispatchTime).not.toBeChecked()
  await showDispatchTime.check()
  const range = page.getByRole('group', { name: 'Väljasaatmise ajavahemik' })
  await range.getByLabel('Alates').fill('5')
  await range.getByLabel('Kuni').fill('3')
  await expect(page.getByRole('alert')).toHaveText('Ajavahemiku lõpp ei tohi olla algusest väiksem.')
  await expect(page.getByRole('button', { name: 'Salvesta', exact: true })).toBeDisabled()
  // Wait beyond the settings debounce to verify invalid ranges are not autosaved.
  await page.waitForTimeout(2200)
  expect(backend.currentStore().settings).toEqual({ ...store.settings, deliverySettings })
  await range.getByLabel('Alates').fill('2')
  await range.getByLabel('Ühik').selectOption('weeks')
  await expect(page.getByText('Ostjale kuvatakse: Saadame 2–3 nädalaga')).toBeVisible()
  await page.getByRole('button', { name: 'Salvesta', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Salvestatud', exact: true })).toBeVisible()
  const savedStore = backend.currentStore() as typeof store & { settings: { deliverySettings: typeof deliverySettings & { dispatchTime: { enabled: boolean; min: number; max: number; unit: string } } } }
  expect(savedStore.settings.deliverySettings).toEqual({ ...deliverySettings, dispatchTime: { enabled: true, min: 2, max: 3, unit: 'weeks' } })

  await page.reload()
  await expect(page.locator('.product-availability small')).toHaveText('Saadame 2–3 nädalaga')
  await page.getByRole('button', { name: /Seaded/ }).click()
  await page.locator('.settings-home button[data-section="delivery"]').click()
  await expect(showDispatchTime).toBeChecked()
  await expect(range.getByLabel('Alates')).toHaveValue('2')
  await expect(range.getByLabel('Kuni')).toHaveValue('3')
  await expect(range.getByLabel('Ühik')).toHaveValue('weeks')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const customer = await browser.newPage({ viewport: { width: 390, height: 844 } })
  try {
    await installSupabaseBackend(customer, store, connectedStripeStatus, { publicStore: savedStore, products })
    await customer.goto(`http://${store.slug}.poeruum.localhost:4174/`)
    await expect(customer.locator('.product-availability small')).toHaveText('Saadame 2–3 nädalaga')
    await customer.getByRole('button', { name: 'Toode 2', exact: true }).click()
    await expect(customer.locator('.product-availability small')).toHaveText('Saadame 2–3 nädalaga')
    await expect(customer.locator('.product-availability strong')).toHaveCount(0)
    await customer.getByRole('button', { name: 'Toode 3', exact: true }).click()
    await expect(customer.locator('.product-availability small')).toHaveText('Hetkel pole tellitav')
    expect(await customer.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  } finally {
    await customer.close()
  }

  await showDispatchTime.uncheck()
  await page.getByRole('button', { name: 'Salvesta', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Salvestatud', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('.product-availability strong')).toHaveText('Laos olemas')
  await expect(page.locator('.product-availability small')).toHaveCount(0)
  await page.getByRole('button', { name: /Seaded/ }).click()
  await page.locator('.settings-home button[data-section="delivery"]').click()
  await expect(showDispatchTime).not.toBeChecked()
  await showDispatchTime.check()
  await expect(range.getByLabel('Alates')).toHaveValue('2')
  await expect(range.getByLabel('Kuni')).toHaveValue('3')
})

test('orders open in a right-side panel with fee details on demand at every screen size', async ({ page }) => {
  const item = { id: 'order-cup', cartKey: 'order-cup-sand', name: 'Keraamiline tass', price: 24,
    image: '/images/kaubamaja-example-ceramics.webp', alt: '', quantity: 2, selectedOptions: { Värv: 'Liivakarva' } }
  const order = {
    order_number: 'PR-20261007-A41', items: [item], customer_name: 'Mari Maasikas', customer_email: 'mari@example.invalid',
    customer_phone: '+372 5123 4567',
    delivery: 'Omniva · Tallinn · Telliskivi Rimi pakiautomaat', product_subtotal: 48, total: 50.9,
    created_at: '2026-10-07T15:35:00Z', status: 'new', payment_status: 'paid',
    stripe_processing_fee_cents: 101, stripe_platform_fee_net_cents: 192,
    stripe_platform_fee_vat_cents: 46, stripe_platform_fee_cents: 238, stripe_seller_net_cents: 4751,
  }
  await installSupabaseBackend(page, store, connectedStripeStatus, {
    products: [{ id: item.id, store_id: STORE_ID, name: item.name, price: item.price, stock: 5, image_url: 'http://localhost:4174/storage/v1/object/public/product-images/auth-preview.svg' }],
    getOrders: () => [order],
  })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await page.getByRole('button', { name: /Tellimused/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Tellimused' })
  await expect(dialog.getByRole('heading', { name: 'Mari Maasikas' })).toBeVisible()
  await expect(dialog.getByRole('link', { name: '+372 5123 4567', exact: true })).toHaveAttribute('href', 'tel:+37251234567')
  await expect(dialog.getByText('Telefon puudub', { exact: true })).toHaveCount(0)
  await expect(dialog.locator('.store-order__total')).toHaveText('Kokku50,90 €')
  await expect(dialog.locator('.store-order__delivery')).toContainText('Telliskivi Rimi pakiautomaat')
  await expect(dialog.getByLabel('Kogus: 2')).toBeVisible()
  const finances = dialog.locator('.store-order__finances')
  await expect(finances.locator('summary')).toContainText('47,51 €')
  await expect(dialog.locator('.order-settlement')).toBeHidden()
  await finances.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(dialog.locator('.order-settlement')).toBeVisible()
  await expect(dialog.locator('.order-settlement')).toContainText('sh neto 1,92 € + käibemaks 0,46 €')
  await expect(finances).toContainText('Panka laekub Stripe’i väljamaksegraafiku järgi.')
  await page.keyboard.press('Enter')
  await finances.locator('summary').blur()
  for (const { width, height } of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }, { width: 844, height: 390 }]) {
    await page.setViewportSize({ width, height })
    await dialog.getByRole('button', { name: 'Märgi täidetuks' }).scrollIntoViewIfNeeded()
    await expect(dialog.getByRole('button', { name: 'Märgi täidetuks' })).toBeInViewport()
    await expect(dialog.getByRole('button', { name: 'Sulge', exact: true })).toBeInViewport()
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const bounds = (await dialog.boundingBox())!
    expect(bounds.x + bounds.width).toBeCloseTo(width, 1)
    expect(bounds.y).toBe(0)
    expect(bounds.height).toBe(height)
    expect(bounds.width).toBeCloseTo(width < 600 ? width : width === 768 ? 700 : Math.max(440, Math.min(620, width * .36)), 1)
    await page.screenshot({ path: `output/orders-drawer-${width}.png`, animations: 'disabled' })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(dialog).toHaveCSS('animation-name', 'none')
  await dialog.focus()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Tellimused/ })).toBeFocused()
  await page.getByRole('button', { name: /Tellimused/ }).click()
  await expect(dialog).toBeVisible()
  await page.mouse.click(20, 150)
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Tellimused/ })).toBeFocused()
})

test('order filters, search and fulfillment retain accurate states in the scrolling side panel', async ({ page }) => {
  const base = {
    items: [], customer_email: 'ostja@example.invalid', delivery: 'Tulen ise järele', product_subtotal: 20, total: 20,
    created_at: '2026-10-07T12:00:00Z', status: 'new', payment_status: 'paid', stripe_seller_net_cents: 1800,
  }
  const orders = [
    { ...base, order_number: 'PR-NEW', customer_name: 'Mari Maasikas' },
    { ...base, order_number: 'PR-DONE', customer_name: 'Jüri Tamm', status: 'fulfilled' },
    { ...base, order_number: 'PR-REFUND', customer_name: 'Kati Kask', status: 'refunded', payment_status: 'refunded' },
    { ...base, order_number: 'PR-PENDING', customer_name: 'Peeter Paju', stripe_refund_status: 'pending' },
  ]
  await page.setViewportSize({ width: 1440, height: 900 })
  await installSupabaseBackend(page, store, connectedStripeStatus, {
    products: [{ id: 'cup', store_id: STORE_ID, name: 'Tass', price: 20, stock: 5, image_url: 'http://localhost:4174/storage/v1/object/public/product-images/auth-preview.svg' }],
    getOrders: () => orders,
  })
  const fulfilled: string[] = []
  await page.route('**/rest/v1/rpc/mark_order_fulfilled', (route) => {
    fulfilled.push(route.request().postDataJSON().target_order_number)
    orders[0].status = 'fulfilled'
    return json(route, null)
  })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await page.getByRole('button', { name: /Tellimused/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Tellimused' })
  const filters = dialog.getByRole('group', { name: 'Tellimuste olek' })
  await expect(dialog.getByRole('article')).toHaveCount(4)
  await expect(dialog.getByText('Telefon puudub', { exact: true })).toHaveCount(4)
  await expect(dialog.locator('a[href^="tel:"]')).toHaveCount(0)
  await dialog.getByRole('article').last().scrollIntoViewIfNeeded()
  await expect(dialog.getByRole('button', { name: 'Sulge', exact: true })).toBeInViewport()
  await expect(filters).toBeInViewport()
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await filters.getByRole('button', { name: 'Tagastused 2', exact: true }).click()
  await expect(dialog.getByRole('article')).toHaveCount(2)
  await expect(dialog.locator('.store-order__finances')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Märgi täidetuks' })).toHaveCount(0)
  await filters.getByRole('button', { name: 'Uued 1', exact: true }).click()
  await expect(dialog.getByRole('article')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Märgi täidetuks' }).click()
  await expect(dialog.getByRole('heading', { name: 'Kõik on tehtud' })).toBeVisible()
  expect(fulfilled).toEqual(['PR-NEW'])
  await filters.getByRole('button', { name: 'Kõik 4', exact: true }).click()
  const search = dialog.getByRole('searchbox')
  await search.fill('jüri')
  await expect(dialog.getByRole('article')).toHaveCount(1)
  await expect(dialog.getByRole('heading', { name: 'Jüri Tamm' })).toBeVisible()
  await search.fill('olematu')
  await expect(dialog.getByRole('heading', { name: 'Tellimusi ei leitud' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Näita kõiki tellimusi' }).click()
  await expect(dialog.getByRole('article')).toHaveCount(4)
  await page.screenshot({ path: 'output/orders-drawer-list.png', animations: 'disabled' })
  orders.splice(0)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(dialog.getByRole('heading', { name: 'Esimene tellimus on veel tulekul' })).toBeVisible()
})

test('an unfulfilled order stays refunding until the server confirms the refund', async ({ page }) => {
  const order = {
    order_number: 'PR-REFUND-TEST', items: [], customer_name: 'Testostja', customer_email: 'test@example.invalid',
    delivery: 'Tulen ise järele', product_subtotal: 27.32, total: 27.32, created_at: new Date().toISOString(),
    status: 'new', payment_status: 'paid', stripe_refund_status: null as string | null,
    stripe_processing_fee_cents: 66, stripe_platform_fee_net_cents: 109,
    stripe_platform_fee_vat_cents: 26, stripe_platform_fee_cents: 135, stripe_seller_net_cents: 2531,
  }
  let refundRequests = 0
  await installSupabaseBackend(page, store, connectedStripeStatus, {
    products: [{ id: 'test-product', store_id: STORE_ID, name: 'Testtoode', slug: 'testtoode', price: 27.32,
      stock: 2, image_url: 'http://localhost:4174/storage/v1/object/public/product-images/auth-preview.svg' }],
    getOrders: () => [order],
    refundOrder: () => { refundRequests += 1; order.stripe_refund_status = 'pending'; return { refunded: false, pending: true } },
  })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await page.getByRole('button', { name: /Tellimused/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Tellimused' })
  await expect(dialog.locator('.order-settlement')).toContainText('25,31 €')
  await expect(dialog.getByRole('button', { name: 'Märgi täidetuks' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Tagasta makse' }).click()
  await expect(dialog.getByText('Tagastamisel', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Sulle laekub', { exact: true })).toHaveCount(0)
  await expect(dialog.getByText('Makse tagastatud', { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Tagasta makse' })).toHaveCount(0)
  order.status = 'refunded'
  order.payment_status = 'refunded'
  order.stripe_refund_status = 'succeeded'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(dialog.getByText('Makse tagastatud', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Sulle laekub', { exact: true })).toHaveCount(0)
  expect(refundRequests).toBe(1)
})

test('platform fee invoices download privately and display credits and recoverable errors', async ({ page }) => {
  await installSupabaseBackend(page, store, connectedStripeStatus)
  let fail = true
  await page.route('**/functions/v1/platform-invoices', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    } })
    expect(request.headers().authorization).toMatch(/^Bearer /)
    const body = request.postDataJSON()
    expect(body.storeId).toBe(STORE_ID)
    if (fail) return json(route, { error: 'Arvete laadimine katkes.' }, 503)
    if (body.documentId) return route.fulfill({ contentType: 'application/pdf', headers: { 'Access-Control-Allow-Origin': '*' }, body: '%PDF-1.7\nTest invoice' })
    return json(route, { documents: [
      { id: 'invoice-1', number: 'PF-2026-000001', kind: 'invoice', issuedAt: '2026-10-01T07:00:00Z', totalCents: 496, ready: true },
      { id: 'credit-1', number: 'PF-2026-000002', kind: 'credit', issuedAt: '2026-10-01T08:00:00Z', totalCents: 496, ready: true },
    ], hasMore: false })
  })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await page.getByRole('button', { name: /Seaded/ }).click()
  await page.locator('.settings-home button[data-section="billing"]').click()
  const invoices = page.getByRole('region', { name: 'Poeruumi müügitasu arved' })
  await expect(invoices.getByRole('alert')).toHaveText('Arvete laadimine katkes.')
  fail = false
  await invoices.getByRole('button', { name: 'Värskenda' }).click()
  await expect(invoices.getByRole('button', { name: /Kreeditarve PF-2026-000002/ })).toContainText('-4,96 €')
  const download = page.waitForEvent('download')
  await invoices.getByRole('button', { name: /^Arve PF-2026-000001/ }).click()
  expect((await download).suggestedFilename()).toBe('Arve-PF-2026-000001.pdf')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(invoices).toBeVisible()
  expect(await invoices.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})

test('monthly fees preserve each payment’s recorded net and VAT and exclude refunded orders', async ({ page }) => {
  const orders = Array.from({ length: 10 }, (_, index) => ({
    order_number: `PR-FEE-${index}`, items: [], customer_name: 'Ostja', customer_email: 'ostja@example.invalid',
    delivery: 'Järeletulemine', product_subtotal: 0.75, total: 0.75, created_at: new Date().toISOString(),
    status: 'fulfilled', payment_status: 'paid', stripe_platform_fee_net_cents: 3,
    stripe_platform_fee_vat_cents: 1, stripe_platform_fee_cents: 4,
  }))
  orders.push({ ...orders[0], order_number: 'PR-FEE-REFUNDED', status: 'refunded', payment_status: 'refunded',
    product_subtotal: 100, total: 100, stripe_platform_fee_net_cents: 400,
    stripe_platform_fee_vat_cents: 96, stripe_platform_fee_cents: 496 })
  await installSupabaseBackend(page, { ...store, settings: { ...store.settings,
    sellerType: 'entrepreneur', sellerFirstName: 'Liisa', sellerLastName: 'Tamm', entrepreneurPayoutConfirmed: true, registryCode: '', vatRegistered: false,
  } }, connectedStripeStatus, { getOrders: () => orders })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await page.getByRole('button', { name: /Seaded/ }).click()
  await page.locator('.settings-home button[data-section="billing"]').click()
  const summary = page.locator('.billing-current')
  await expect(summary.locator('header strong')).toHaveText('0,40 €')
  await expect(summary).toContainText('Toodete müük 7,50 €')
  await expect(summary).toContainText('Netotasu 0,30 € · käibemaks 24% 0,10 €')
  await expect(summary).toContainText('Kuulaeni 47,96 €')
  for (const fees of [
    { stripe_platform_fee_net_cents: 3900, stripe_platform_fee_vat_cents: 934, stripe_platform_fee_cents: 4834 },
    { stripe_platform_fee_net_cents: 3869, stripe_platform_fee_vat_cents: 967, stripe_platform_fee_cents: 4836 },
  ]) {
    orders.splice(0, orders.length, { ...orders[0], ...fees })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(summary).toContainText('Hinnalagi täis')
    await expect(summary).toContainText('Sel kuul rohkem Poeruumi tasu ei lisandu.')
    await expect(summary.locator('.billing-current__progress i')).toHaveAttribute('style', 'width: 100%;')
  }
})

for (const storefrontUrl of ['http://kruk-kruk.poeruum.localhost:4174/', '/p/kruk-kruk/']) {
  test(`merchant login leaves the visited store URL: ${storefrontUrl}`, async ({ page }) => {
    const backend = await installSupabaseBackend(page, store, connectedStripeStatus, { publicStore: otherStore })
    await page.goto(storefrontUrl)
    await expect(page.getByRole('heading', { name: 'Teise poe toode', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Poe omanikule: ava poe halduse sisselogimine' }).click()
    await expect(page).toHaveURL('http://poeruum.localhost:4174/?continue_setup=1')
    await expect(page.getByRole('dialog', { name: 'Logi sisse' })).toHaveCount(0)
    await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
    await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
    await page.getByRole('button', { name: /Jätka oma poega/ }).click()
    await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
    await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
    await expect(page.getByRole('button', { name: store.name, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Teise poe toode', exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
    await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
    expect(backend.passwordSignIns()).toBe(1)
  })
}

test('a public store keeps its own content when another merchant is already signed in', async ({ page }) => {
  const backend = await installSupabaseBackend(page, store, connectedStripeStatus, { publicStore: otherStore })
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await page.goto('/p/kruk-kruk/')
  await expect(page.getByRole('heading', { name: 'Teise poe toode', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Seaded/ })).toHaveCount(0)
  await expect(page.locator('.support-launcher')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Ava Poeruumi klienditugi' })).toBeHidden()
  await page.getByRole('button', { name: 'Poe omanikule: ava poe halduse sisselogimine' }).click()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
  expect(backend.passwordSignIns()).toBe(1)
})

test('legacy storefront owner-login links open the platform login', async ({ page }) => {
  await installSupabaseBackend(page, store, connectedStripeStatus, { publicStore: otherStore })
  await page.goto('http://kruk-kruk.poeruum.localhost:4174/?owner_login=1')
  await expect(page).toHaveURL('http://poeruum.localhost:4174/?continue_setup=1')
  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Logi sisse' })).toHaveCount(0)
})

test('existing merchant never sees new-store onboarding while their store loads', async ({ page }) => {
  let releaseProducts = () => undefined
  const productsBlocked = new Promise<void>((resolve) => { releaseProducts = resolve })
  await installSupabaseBackend(page, store, connectedStripeStatus, {
    beforeProductsResponse: () => productsBlocked,
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()

  await expect(page.getByLabel('Laadin sinu poodi')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Poe nimi' })).toHaveCount(0)

  releaseProducts()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Poe nimi' })).toHaveCount(0)
})

test('a stale creation form resumes the existing store without overwriting it', async ({ page }) => {
  const backend = await installSupabaseBackend(page)
  let firstLookup = true
  const writes: string[] = []
  await page.route('**/rest/v1/stores?*', async (route) => {
    const request = route.request()
    if (request.method() === 'GET' && firstLookup) {
      firstLookup = false
      await json(route, [])
      return
    }
    if (['POST', 'PATCH'].includes(request.method())) writes.push(request.method())
    await route.fallback()
  })

  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('heading', { name: 'Poe nimi' })).toBeVisible()
  await page.getByLabel('Poe nimi', { exact: true }).fill('Accidental second store')
  await page.getByRole('button', { name: /Jätka müüja andmetega/ }).click()

  await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
  await expect(page.getByRole('button', { name: 'Seaded', exact: true })).toBeVisible()
  expect(backend.currentStore()).toEqual(store)
  expect(writes).toEqual([])
})

test('merchant presence reports the visible view and stops when the tab is hidden', async ({ page }) => {
  await installSupabaseBackend(page)
  const touches: Array<{ target_session_id: string; current_view_value: string }> = []
  const leaves: string[] = []
  await page.route('**/rpc/touch_user_presence_view', async (route) => {
    touches.push(route.request().postDataJSON())
    await json(route, null)
  })
  await page.route('**/rpc/leave_user_presence', async (route) => {
    leaves.push(route.request().postDataJSON().target_session_id)
    await json(route, null)
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('button', { name: 'Seaded', exact: true })).toBeVisible()
  await expect.poll(() => touches.at(-1)?.current_view_value).toBe('storefront')
  await page.clock.install()
  const sessionId = touches.at(-1)!.target_session_id
  const leaveCount = leaves.length
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => leaves.length).toBeGreaterThan(leaveCount)
  expect(leaves.at(-1)).toBe(sessionId)
  const touchCount = touches.length
  await page.clock.fastForward(60_000)
  expect(touches).toHaveLength(touchCount)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => touches.length).toBeGreaterThan(touchCount)
  expect(touches.at(-1)).toEqual({ target_session_id: sessionId, current_view_value: 'storefront' })
})

test('merchant logout returns to the Poeruum homepage', async ({ page }) => {
  await installSupabaseBackend(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()

  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await page.getByRole('button', { name: 'Seaded', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Seaded' })
  await settings.getByRole('button', { name: /Konto/ }).click()
  await settings.getByRole('button', { name: 'Logi välja', exact: true }).click()

  await expect(page.getByRole('heading', { name: /Sinu e-pood/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Logi sisse' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tagasi poe muutmisvaatesse' })).toHaveCount(0)
  await expect(page).toHaveURL('http://poeruum.localhost:4174/')
  await page.goto('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
  await expect(page).toHaveURL('http://poeruum.localhost:4174/?continue_setup=1')
})

test('a saved login migrates to the owner address and cannot reopen another shop management', async ({ page }) => {
  const backend = await installSupabaseBackend(page, store, connectedStripeStatus, { publicStore: otherStore })
  await page.addInitScript(({ accessToken, user }) => {
    if (location.hostname !== 'poeruum.localhost') return
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify({
      access_token: accessToken,
      refresh_token: 'playwright-refresh-token',
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    }))
  }, { accessToken, user })
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
  await page.goto('http://kruk-kruk.poeruum.localhost:4174/haldus')
  await expect(page.getByRole('button', { name: store.name, exact: true })).toBeVisible()
  await expect(page).toHaveURL('http://sisselogimise-testipood.poeruum.localhost:4174/haldus')
  expect(backend.passwordSignIns()).toBe(0)

  await page.getByRole('button', { name: 'Seaded', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Seaded' })
  await settings.getByRole('button', { name: /Konto/ }).click()
  await settings.getByRole('button', { name: 'Logi välja', exact: true }).click()
  await expect(page).toHaveURL('http://poeruum.localhost:4174/')
  // The init script recreates an old origin-local session; logout must win.
  await expect(page.getByRole('button', { name: 'Logi sisse' }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Logi sisse' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Seaded/ })).toHaveCount(0)
})

test('a draft can continue setup while Stripe verifies submitted details', async ({ page }) => {
  const pendingStore = {
    ...store,
    is_published: false,
    payment_status: 'pending',
    stripe_account_charges_enabled: false,
    stripe_account_payouts_enabled: false,
    stripe_account_requirements_due_count: 0,
    stripe_account_requirements_past_due: false,
    stripe_account_requirements_deadline: null,
    stripe_account_requirements_pending_verification: true,
    stripe_account_requirements_disabled_reason: 'requirements.pending_verification',
    stripe_account_requirement_issues: [],
    settings: { ...store.settings, onboardingStep: 'payments' },
  }
  const pendingStripeStatus = {
    status: 'pending',
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: true,
    requirements: {
      dueCount: 0,
      pastDue: false,
      currentDeadline: null,
      pendingVerification: true,
      disabledReason: 'requirements.pending_verification',
      issues: [],
    },
  }
  await installSupabaseBackend(page, pendingStore, pendingStripeStatus)

  await page.goto('/')
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()

  await expect(page.getByRole('heading', { name: 'Poe maksed' })).toBeVisible()
  await expect(page.getByText('Stripe kontrollib andmeid')).toBeVisible()
  await expect(page.getByText(/Kõik vajalik on esitatud/)).toBeVisible()
  await page.getByRole('button', { name: /Jätka tarnega/ }).click()
  await expect(page.getByRole('heading', { name: 'Vali tarneviisid' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Jätka maksete seadistamist/ })).toHaveCount(0)
})

test('Stripe requirements email link survives login and opens the owned store payment settings', async ({ page }) => {
  const backend = await installSupabaseBackend(page)

  await page.goto('/?stripe_requirements=1')

  await expect(page.getByRole('heading', { name: 'Logi sisse', exact: true })).toBeVisible()
  await expect(page.getByText('Logi sisse, et Stripe’i andmeid täiendada.')).toBeVisible()
  await expect(page).toHaveURL(/stripe_requirements=1/)

  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()

  const settings = page.getByRole('dialog', { name: 'Seaded' })
  await expect(settings).toBeVisible()
  await expect(settings.getByRole('heading', { name: 'Maksed' })).toBeVisible()
  await expect(settings.locator('.payments-panel')).toBeVisible()
  await expect(settings.getByText('Maksete jätkamiseks kinnita müüja andmed')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Andmete kinnitamine' })).toBeVisible()
  await expect(page.getByText('Andmete kinnitamine on avatud maksete vaates.')).toHaveCount(0)
  await expect(page).not.toHaveURL(/stripe_requirements=/)
  expect(backend.passwordSignIns()).toBe(1)
})

test('Stripe return on the shop hostname opens payment settings with the existing session', async ({ page }) => {
  const backend = await installSupabaseBackend(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()

  await page.goto('http://sisselogimise-testipood.poeruum.localhost:4174/?stripe_requirements=1')

  const settings = page.getByRole('dialog', { name: 'Seaded' })
  await expect(settings).toBeVisible()
  await expect(settings.getByRole('heading', { name: 'Maksed' })).toBeVisible()
  await expect(settings.locator('.payments-panel')).toBeVisible()
  await expect(settings.getByText('Maksete jätkamiseks kinnita müüja andmed')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Andmete kinnitamine' })).toBeVisible()
  await expect(page.getByText('Andmete kinnitamine on avatud maksete vaates.')).toHaveCount(0)
  await expect(page).not.toHaveURL(/stripe_requirements=/)
  expect(backend.passwordSignIns()).toBe(1)
  expect(backend.sessionRefreshes()).toBeGreaterThanOrEqual(1)
})

const receiptToken = 'a'.repeat(64)
const receiptFixture = {
  status: 'paid', orderNumber: 'PR-RECEIPT-TEST', storeName: 'Kruusipood', createdAt: '2026-09-09T12:00:00Z',
  currency: 'eur', total: 27.32, deliveryTotal: 3.32, delivery: 'Omniva · Tallinn · Testi pakiautomaat',
  items: [{ name: 'Sinine kruus', quantity: 2, unitPrice: 12, options: { Värv: 'Sinine' } }], resumeUrl: null,
}
const receiptPath = `/p/kruusipood?checkout=status#receipt=${receiptToken}`

async function receiptBackend(page: Page, response: () => { body: unknown; status?: number }) {
  const requests: unknown[] = []
  await page.route('**/__e2e_supabase/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' } })
      return
    }
    if (route.request().url().endsWith('/functions/v1/order-receipt')) {
      requests.push(route.request().postDataJSON())
      const result = response()
      await json(route, result.body, result.status)
    } else await json(route, [])
  })
  return requests
}

test('receipt persists after reload, uses the server status and works without a published storefront', async ({ page }) => {
  const requests = await receiptBackend(page, () => ({ body: { receipt: receiptFixture } }))
  await page.goto(receiptPath)
  await expect(page.getByRole('heading', { name: 'Makse õnnestus' })).toBeVisible()
  await expect(page.getByText('PR-RECEIPT-TEST')).toBeVisible()
  await expect(page.getByText('Omniva · Tallinn · Testi pakiautomaat')).toBeVisible()
  await expect(page.getByText('Sinine kruus')).toBeVisible()
  await expect(page.locator('.order-receipt__total')).toContainText('27,32')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Makse õnnestus' })).toBeVisible()
  await expect(page.getByText('PR-RECEIPT-TEST')).toBeVisible()
  expect(requests.length).toBeGreaterThanOrEqual(2)
  expect(requests.every((body) => JSON.stringify(body) === JSON.stringify({ token: receiptToken }))).toBe(true)
  expect(new URL(page.url()).search).not.toContain(receiptToken)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByRole('link', { name: 'Tagasi poodi' })).toHaveAttribute('href', '/p/kruusipood')
})

test('success URL cannot manufacture a confirmation and a damaged token reveals no order', async ({ page }) => {
  const requests = await receiptBackend(page, () => ({ status: 404, body: { error: 'Selle lingiga tellimust ei leitud.' } }))
  await page.goto('/p/kruusipood?checkout=success')
  await expect(page.getByRole('heading', { name: 'Tellimuse olek pole teada' })).toBeVisible()
  expect(requests).toHaveLength(0)
  await expect(page.getByText('Makse õnnestus', { exact: true })).toHaveCount(0)
  await page.goto(receiptPath)
  await expect(page.getByRole('alert')).toHaveText('Selle lingiga tellimust ei leitud.')
  await expect(page.getByText('PR-RECEIPT-TEST')).toHaveCount(0)
})

test('pending receipt polls to confirmed payment without depending on email delivery', async ({ page }) => {
  let paid = false
  await receiptBackend(page, () => ({ body: { receipt: { ...receiptFixture, status: paid ? 'paid' : 'pending' } } }))
  await page.goto(receiptPath)
  await expect(page.getByRole('heading', { name: 'Kontrollime makset' })).toBeVisible()
  await expect(page.getByText(/Ära tee uut makset/)).toBeVisible()
  paid = true
  await expect(page.getByRole('heading', { name: 'Makse õnnestus' })).toBeVisible({ timeout: 10000 })
})

test('temporary network failure stays unknown and explicit retry recovers', async ({ page }) => {
  let failed = true
  await receiptBackend(page, () => failed ? { status: 503, body: { error: 'Ajutine ühenduse tõrge.' } } : { body: { receipt: receiptFixture } })
  await page.goto(receiptPath)
  await expect(page.getByRole('alert')).toHaveText('Ajutine ühenduse tõrge.')
  await expect(page.getByRole('heading', { name: 'Tellimuse olek pole teada' })).toBeVisible()
  await expect(page.getByText('Makse ebaõnnestus', { exact: true })).toHaveCount(0)
  failed = false
  await page.getByRole('button', { name: 'Kontrolli olekut uuesti' }).click()
  await expect(page.getByRole('heading', { name: 'Makse õnnestus' })).toBeVisible()
})

test('legacy checkout returns use their session credential and do not trust the cancelled flag', async ({ page }) => {
  const requests = await receiptBackend(page, () => ({ body: { receipt: receiptFixture } }))
  const sessionId = 'cs_test_' + 'b'.repeat(40)
  await page.goto(`/p/kruusipood?checkout=cancelled&session_id=${sessionId}`)
  await expect(page.getByRole('heading', { name: 'Makse õnnestus' })).toBeVisible()
  expect(requests).toContainEqual({ sessionId })
  expect(new URL(page.url()).search).not.toContain(sessionId)
  expect(new URL(page.url()).hash).toContain(sessionId)
})

test('mobile failed, expired and refunded receipts show the actual state; retry reuses the existing checkout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let status = 'failed'
  const resumeUrl = 'https://checkout.stripe.com/c/pay/existing-session'
  await receiptBackend(page, () => ({ body: { receipt: { ...receiptFixture, status, resumeUrl: status === 'failed' ? resumeUrl : null } } }))
  await page.goto(receiptPath)
  await expect(page.getByRole('heading', { name: 'Makse ebaõnnestus' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Jätka maksmist' })).toHaveAttribute('href', resumeUrl)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  status = 'expired'
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Makseleht on aegunud' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Jätka maksmist' })).toHaveCount(0)
  status = 'refunded'
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Makse on tagastatud' })).toBeVisible()
})

test('checkout explains Link and opens a payment page only after the customer continues', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let checkoutRequests = 0
  await receiptBackend(page, () => ({ body: { receipt: { ...receiptFixture, status: 'unpaid' } } }))
  // Register checkout after the general backend so Playwright selects it first.
  await page.route('**/__e2e_supabase/functions/v1/stripe-store-checkout', async (route) => {
    checkoutRequests++
    await json(route, { url: `http://poeruum.localhost:4174${receiptPath}` })
  })
  await page.goto('/?checkout=status')
  await expect(page.getByRole('heading', { name: 'Tellimuse olek pole teada' })).toBeVisible()
  await page.evaluate(async () => {
    const { mountCheckoutHarness } = await import('/e2e/checkout-harness.tsx')
    mountCheckoutHarness()
  })
  await expect(page.getByText(/Link võib kasutada sinu varem salvestatud makseandmeid/)).toBeVisible()
  await page.getByRole('textbox', { name: 'Nimi', exact: true }).fill('Test Ostja')
  await page.getByRole('textbox', { name: 'E-post', exact: true }).fill('ostja@example.invalid')
  await page.getByRole('textbox', { name: 'Telefon', exact: true }).fill('+37255555555')
    await page.getByRole('textbox', { name: 'Aadress', exact: true }).fill('Testi 1, Tallinn, 10111')
  expect(checkoutRequests).toBe(0)
  await page.getByRole('button', { name: 'Edasi maksma · 27,32 €' }).click()
  await expect(page.getByRole('heading', { name: 'Makse on lõpetamata' })).toBeVisible()
  expect(checkoutRequests).toBe(1)
})

test('checkout and cart totals use cents at the free delivery boundary', async ({ page }) => {
  await receiptBackend(page, () => ({ body: { receipt: receiptFixture } }))
  for (const threshold of [50, 50.01]) {
    await page.goto('/?checkout=status')
    await page.evaluate(async (freeShippingFrom) => {
      const { mountCheckoutHarness } = await import('/e2e/checkout-harness.tsx')
      mountCheckoutHarness({ initialStep: 'cart', vatRegistered: true,
        items: [
          { id: 'sale', name: 'Soodustoode', price: 4, salePrice: 3.26, quantity: 10, image: '/images/kaubamaja-example-art.webp', alt: '', cartKey: 'sale', selectedOptions: {} },
          { id: 'other', name: 'Teine toode', price: 17.40, quantity: 1, image: '/images/kaubamaja-example-art.webp', alt: '', cartKey: 'other', selectedOptions: {} },
        ],
        deliverySettings: { parcelProviders: { omniva: { enabled: false, price: 3.5 }, dpd: { enabled: false, price: 3.5 }, smartposti: { enabled: false, price: 3.5 } },
          courierEnabled: true, courierPrice: 3.5, pickupEnabled: true, pickupAddress: 'Testi 1', freeShippingFrom },
      })
    }, threshold)
    await expect(page.locator('.cart-total strong')).toHaveText('50,00 €')
    await expect(page.getByText('32,60 €', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Vormista tellimus' }).click()
    const freeDelivery = threshold === 50
    await expect(page.getByRole('button', { name: `Edasi maksma · ${freeDelivery ? '50,00' : '53,50'} €` })).toBeVisible()
    await expect(page.locator('.vat-row')).toContainText(freeDelivery ? '9,68 €' : '10,35 €')
    await expect(page.locator('.checkout-summary').getByText(freeDelivery ? '0,00 €' : '3,50 €', { exact: true })).toBeVisible()
  }
})

test('checkout retries keep their attempt after errors and reloads, and change it for a different purchase', async ({ page }) => {
  const attempts: Array<{ checkoutRequestId: string }> = []
  await receiptBackend(page, () => ({ body: { receipt: receiptFixture } }))
  await page.route('**/__e2e_supabase/functions/v1/stripe-store-checkout', async (route) => {
    attempts.push(route.request().postDataJSON())
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Ajutine ühenduse tõrge.' }) })
  })
  const mount = async () => {
    await page.evaluate(async () => {
      const { mountCheckoutHarness } = await import('/e2e/checkout-harness.tsx')
      mountCheckoutHarness()
    })
    await page.getByRole('textbox', { name: 'Nimi', exact: true }).fill('Test Ostja')
    await page.getByRole('textbox', { name: 'E-post', exact: true }).fill('ostja@example.invalid')
    await page.getByRole('textbox', { name: 'Telefon', exact: true }).fill('+37255555555')
    await page.getByRole('textbox', { name: 'Aadress', exact: true }).fill('Testi 1, Tallinn, 10111')
  }
  const submit = async () => {
    await page.getByRole('button', { name: 'Edasi maksma · 27,32 €' }).click()
    await expect(page.getByRole('button', { name: 'Edasi maksma · 27,32 €' })).toBeEnabled()
    await expect(page.getByText('Ajutine ühenduse tõrge.', { exact: true })).toBeVisible()
  }
  await page.goto('/?checkout=status')
  await mount(); await submit(); await submit()
  await page.reload(); await mount(); await submit()
  expect(attempts).toHaveLength(3)
  expect(new Set(attempts.map((attempt) => attempt.checkoutRequestId)).size).toBe(1)
  const storage = await page.evaluate(() => sessionStorage.getItem('poeruum-checkout-attempt-v1'))
  expect(storage).not.toContain('ostja@example.invalid')
  await page.getByRole('textbox', { name: 'E-post', exact: true }).fill('teine@example.invalid')
  await submit()
  expect(attempts[3].checkoutRequestId).not.toBe(attempts[0].checkoutRequestId)
})

test('a terminal receipt clears the completed attempt and explains starting again', async ({ page }) => {
  await receiptBackend(page, () => ({ body: { receipt: { ...receiptFixture, status: 'failed', resumeUrl: null } } }))
  await page.goto('/?checkout=status')
  await page.evaluate(() => sessionStorage.setItem('poeruum-checkout-attempt-v1', JSON.stringify({ fingerprint: 'test', requestId: 'old' })))
  await page.goto(receiptPath)
  await expect(page.getByRole('heading', { name: 'Makse ebaõnnestus' })).toBeVisible()
  await expect(page.getByText('Selle tellimuse eest pole kinnitatud makset. Uue tellimuse saad vormistada poes.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Jätka maksmist' })).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('poeruum-checkout-attempt-v1'))).toBeNull()
})


test('company checkout sends billing details and changes the attempt when the invoice recipient changes', async ({ page }) => {
  const requests: Array<{ checkoutRequestId: string; billing: { company: boolean; name: string; registryCode: string; address: string } }> = []
  await receiptBackend(page, () => ({ body: { receipt: receiptFixture } }))
  await page.route('**/__e2e_supabase/functions/v1/stripe-store-checkout', async (route) => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Ajutine tõrge.' }) })
  })
  await page.goto('/?checkout=status')
  await page.evaluate(async () => {
    const { mountCheckoutHarness } = await import('/e2e/checkout-harness.tsx')
    mountCheckoutHarness()
  })
  await page.getByRole('textbox', { name: 'Nimi', exact: true }).fill('Õie Ostja')
  await page.getByRole('textbox', { name: 'E-post', exact: true }).fill('ostja@example.invalid')
  await page.getByRole('textbox', { name: 'Telefon', exact: true }).fill('+37255555555')
  await page.getByRole('checkbox', { name: 'Ostan ettevõttele' }).check()
  await page.getByRole('textbox', { name: 'Ettevõtte nimi', exact: true }).fill('Ostja OÜ')
  await page.getByRole('textbox', { name: 'Registrikood', exact: true }).fill('12345678')
  await page.getByRole('textbox', { name: 'Aadress', exact: true }).fill('Testi 1, Tallinn, 10111')
  await page.getByRole('button', { name: 'Edasi maksma · 27,32 €' }).click()
  await expect(page.getByText('Ajutine tõrge.')).toBeVisible()
  expect(requests[0].billing).toEqual({ company: true, name: 'Ostja OÜ', registryCode: '12345678', vatNumber: '', address: 'Testi 1, Tallinn, 10111' })
  await page.getByRole('textbox', { name: 'Ettevõtte nimi', exact: true }).fill('Teine OÜ')
  await page.getByRole('button', { name: 'Edasi maksma · 27,32 €' }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[1].checkoutRequestId).not.toBe(requests[0].checkoutRequestId)
})

test('private receipt downloads its invoice and credit without exposing a public file URL', async ({ page }) => {
  const invoice = { id: '79000000-0000-4000-8000-000000000003', number: 'TEST-PR1-2026-000001', kind: 'invoice', ready: true }
  const credit = { ...invoice, id: '79000000-0000-4000-8000-000000000004', number: 'TEST-PR1-2026-000002', kind: 'credit' }
  const bodies: Array<{ token: string; documentId?: string }> = []
  await receiptBackend(page, () => ({ body: { receipt: { ...receiptFixture, status: 'refunded', hasInvoice: true } } }))
  await page.route('**/__e2e_supabase/functions/v1/order-documents', async (route) => {
    const body = route.request().postDataJSON()
    bodies.push(body)
    if (body.documentId) await route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.7\n%%EOF' })
    else await json(route, { documents: [invoice, credit] })
  })
  await page.goto(receiptPath)
  await expect(page.getByRole('button', { name: 'Arve TEST-PR1-2026-000001 · PDF', exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Arve TEST-PR1-2026-000001 · PDF', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('Arve-TEST-PR1-2026-000001.pdf')
  await expect(page.getByRole('button', { name: 'Kreeditarve TEST-PR1-2026-000002 · PDF', exact: true })).toBeVisible()
  expect(bodies[0].token).toHaveLength(64)
  expect(bodies[1]).toEqual({ token: bodies[0].token, documentId: invoice.id })
  await expect(page.locator('a[href*="order-documents"]')).toHaveCount(0)
})


test('temporary-email merchant can keep a draft and must confirm the replacement address', async ({ page }) => {
  const draft = { ...store, is_published: false, stripe_account_id: null, payment_status: 'idle',
    settings: { ...store.settings, onboardingStep: 'payments' } }
  const backend = await installSupabaseBackend(page, draft, { status: 'idle', detailsSubmitted: false }, { temporaryEmail: true })
  await page.goto('/')
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await page.getByLabel('E-posti aadress').fill('trial@minitts.net')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  const notice = page.getByRole('complementary', { name: 'Konto e-posti kinnitamine' })
  await expect(notice).toContainText('Lisa püsiv e-posti aadress')
  await page.getByRole('button', { name: 'Seadista maksed', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('vaheta konto ajutine e-post')
  await expect(page.getByRole('dialog', { name: 'Stripe’i andmed' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Jäta praegu vahele' }).click()
  await expect(page.getByRole('heading', { name: 'Vali tarneviisid' })).toBeVisible()
  await expect(notice).toHaveCount(0)
  await page.getByRole('button', { name: 'Tagasi eelmisele lehele' }).click()
  await notice.getByRole('button', { name: 'Muuda aadressi' }).click()
  await notice.getByLabel('Uus e-posti aadress').fill('another@tozya.com')
  await notice.getByLabel('Praegune parool', { exact: true }).fill('turvaline-testiparool')
  await notice.getByRole('button', { name: 'Saada kinnituskiri' }).click()
  await expect(notice.getByRole('alert')).toContainText('ajutisele meiliteenusele')
  expect(backend.emailUpdates).toEqual([])
  await notice.getByLabel('Uus e-posti aadress').fill('merchant@example.com')
  await notice.getByRole('button', { name: 'Saada kinnituskiri' }).click()
  await expect(notice).toContainText('Kinnita uus e-posti aadress')
  await expect(notice).toContainText('merchant@example.com')
  await expect(notice).toContainText('trial@minitts.net')
  expect(backend.emailUpdates).toEqual(['merchant@example.com'])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'output/account-email-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Vali tarneviisid' })).toBeVisible()
  await page.getByRole('button', { name: 'Tagasi eelmisele lehele' }).click()
  await expect(notice).toContainText('merchant@example.com')
  await notice.getByRole('button', { name: 'Saada kiri uuesti' }).click()
  await expect(notice.getByRole('status')).toContainText('Kinnituskirjad on uuesti saadetud')
  expect(backend.confirmationRequests).toMatchObject([{ type: 'email_change', email: 'trial@minitts.net' }])
  backend.confirmEmail()
  await notice.getByRole('button', { name: 'Olen kinnitanud' }).click()
  await expect(notice).toHaveCount(0)
})

async function signInThroughLanding(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Logi sisse' }).first().click()
  await page.getByLabel('E-posti aadress').fill(user.email)
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
}

test('email confirmation names the address and sends a letter only when requested', async ({ page }) => {
  const draft = { ...store, is_published: false, stripe_account_id: null, payment_status: 'idle',
    settings: { ...store.settings, onboardingStep: 'payments' } }
  const backend = await installSupabaseBackend(page, draft, { status: 'idle' }, { unconfirmedEmail: true })
  await signInThroughLanding(page)
  const notice = page.getByRole('complementary', { name: 'Konto e-posti kinnitamine' })
  await expect(notice).toContainText('Kinnita oma e-post')
  await expect(notice).toContainText(user.email)
  expect(backend.confirmationRequests).toEqual([])
  await notice.getByRole('button', { name: 'Saada kinnituskiri' }).click()
  await expect(notice.getByRole('status')).toContainText('Ava e-postis Poeruumi kiri')
  expect(backend.confirmationRequests).toMatchObject([{ type: 'signup', email: user.email }])
  await expect(notice.getByRole('button', { name: /Saada uuesti/ })).toBeDisabled()
  await notice.getByRole('button', { name: 'Olen kinnitanud' }).click()
  await expect(notice.getByRole('status')).toContainText('Kinnitus pole veel meieni jõudnud')
  await page.screenshot({ path: 'output/account-email-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'output/account-email-confirm-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  backend.confirmEmail()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(notice).toHaveCount(0)
})

test('an unavailable email check does not claim the address is unconfirmed', async ({ page }) => {
  const draft = { ...store, is_published: false, stripe_account_id: null, payment_status: 'idle',
    settings: { ...store.settings, onboardingStep: 'payments' } }
  const backend = await installSupabaseBackend(page, draft, { status: 'idle' })
  backend.setEmailStatusUnavailable(true)
  await signInThroughLanding(page)
  const retry = page.getByRole('complementary', { name: 'Konto e-posti olek', exact: true })
  await expect(retry).toContainText('E-posti olekut ei saanud praegu kontrollida')
  await expect(page.getByRole('complementary', { name: 'Konto e-posti kinnitamine' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Saada kinnituskiri' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Seadista maksed', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Konto e-posti kontroll ebaõnnestus')
  await expect(page.getByRole('dialog', { name: 'Stripe’i andmed' })).toHaveCount(0)
  backend.setEmailStatusUnavailable(false)
  await retry.getByRole('button', { name: 'Proovi uuesti' }).click()
  await expect(retry).toHaveCount(0)
  backend.setEmailStatusUnavailable(true)
  const response = page.waitForResponse('**/rest/v1/rpc/account_email_status')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await response
  await expect(page.locator('.account-email-notice')).toHaveCount(0)
})

test('first product editing stays clear of email notices even when the check is unavailable', async ({ page }) => {
  const draft = { ...store, is_published: false, stripe_account_id: null, payment_status: 'idle',
    settings: { ...store.settings, onboardingStep: 'product' } }
  const backend = await installSupabaseBackend(page, draft, { status: 'idle' }, { unconfirmedEmail: true })
  backend.setEmailStatusUnavailable(true)
  await signInThroughLanding(page)
  await expect(page.getByRole('textbox', { name: 'Toote nimi', exact: true })).toBeVisible()
  await expect(page.locator('.account-email-notice')).toHaveCount(0)
  await page.screenshot({ path: 'output/first-product-without-email-notice.png', fullPage: true })
  await page.getByRole('button', { name: 'Loobu muudatustest' }).click()
  await expect(page.getByRole('heading', { name: 'Vali tarneviisid' })).toBeVisible()
  await expect(page.locator('.account-email-notice')).toHaveCount(0)
})

test('email confirmation is available inside account settings without a storefront banner', async ({ page }) => {
  const backend = await installSupabaseBackend(page, store, connectedStripeStatus, { unconfirmedEmail: true })
  backend.setEmailStatusUnavailable(true)
  await signInThroughLanding(page)
  await expect(page.getByRole('button', { name: /Seaded/ })).toBeVisible()
  await expect(page.locator('.account-email-notice')).toHaveCount(0)
  await page.getByRole('button', { name: /Seaded/ }).click()
  await page.locator('.settings-home button[data-section="account"]').click()
  const retry = page.getByRole('complementary', { name: 'Konto e-posti olek', exact: true })
  await expect(retry).toBeVisible()
  backend.setEmailStatusUnavailable(false)
  await retry.getByRole('button', { name: 'Proovi uuesti' }).click()
  const notice = page.getByRole('complementary', { name: 'Konto e-posti kinnitamine' })
  await expect(notice).toContainText(user.email)
  await notice.getByRole('button', { name: 'Muuda aadressi' }).click()
  await page.screenshot({ path: 'output/account-email-settings.png', fullPage: true })
  await expect(notice.getByLabel('Uus e-posti aadress')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
})


test('saving a seller payout declaration refreshes Stripe automatically without an admin', async ({ page }) => {
  const stripeStatus: Record<string, unknown> = { ...connectedStripeStatus, status: 'pending',
    setupError: 'Kinnita enda aktiivse ettevõtluskonto kasutamine müüja andmetes.',
    requirements: { ...connectedStripeStatus.requirements, dueCount: 0 } }
  const backend = await installSupabaseBackend(page, { ...store, payment_status: 'pending', settings: {
    ...store.settings, sellerType: 'entrepreneur', sellerFirstName: 'Liisa', sellerLastName: 'Tamm',
    businessName: 'Liisa Tamm', registryCode: '', vatRegistered: false, entrepreneurPayoutConfirmed: false,
  } }, stripeStatus)
  await page.goto('/?continue_setup=1')
  await page.getByLabel('E-posti aadress').fill('kaupmees@example.com')
  await page.getByLabel('Parool', { exact: true }).fill('turvaline-testiparool')
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await page.getByRole('button', { name: /Seaded/ }).click()
  await page.locator('.settings-home button[data-section="payments"]').click()
  await page.getByRole('button', { name: 'Ava müüja andmed' }).click()
  const declaration = page.getByRole('checkbox', { name: 'Kinnitan, et kasutan enda aktiivset LHV ettevõtluskontot', exact: false })
  await expect(declaration).not.toBeChecked()
  const saved = page.waitForResponse(response => response.url().includes('/rest/v1/stores') && response.request().method() === 'PATCH')
  const refreshed = page.waitForResponse(response => response.url().includes('/functions/v1/stripe-connect') && response.request().method() === 'POST')
  stripeStatus.status = 'connected'; stripeStatus.setupError = null
  await declaration.check()
  expect((await saved).ok()).toBe(true)
  expect((await refreshed).ok()).toBe(true)
  expect(backend.currentStore().settings).toMatchObject({ entrepreneurPayoutConfirmed: true })
  await expect(page.getByText('Kinnita enda aktiivse ettevõtluskonto kasutamine müüja andmetes.', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'output/seller-payout-declaration.png', fullPage: true })
})

for (const published of [false, true]) {
  test(`an admin exception keeps seller consent false in ${published ? 'settings' : 'onboarding'}`, async ({ page }) => {
    const backend = await installSupabaseBackend(page, { ...store, is_published: published, settings: {
      ...store.settings, onboardingStep: 'business', sellerType: 'entrepreneur', sellerFirstName: 'Liisa', sellerLastName: 'Tamm',
      businessName: 'Liisa Tamm', registryCode: '', vatRegistered: false, entrepreneurPayoutConfirmed: false,
      entrepreneurPayoutAdminException: true,
    } }, { ...connectedStripeStatus, setupError: null, requirements: { ...connectedStripeStatus.requirements, dueCount: 0 } })
    await signInThroughLanding(page)
    if (published) {
      await page.getByRole('button', { name: /Seaded/ }).click()
      await page.locator('.settings-home button[data-section="business"]').click()
    }
    await expect(page.getByText('Poeruumi administraator on sellele kontole teinud erandi.', { exact: false })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Kinnitan, et kasutan enda aktiivset LHV ettevõtluskontot', exact: false })).toHaveCount(0)
    const saved = page.waitForResponse(response => response.url().includes('/rest/v1/stores') && response.request().method() === 'PATCH')
    if (published) await page.getByLabel('Kontakt-e-post', { exact: true }).fill('updated@example.com')
    else await page.getByRole('button', { name: 'Jätka maksetega' }).click()
    expect((await saved).ok()).toBe(true)
    expect(backend.currentStore().settings).toMatchObject({ entrepreneurPayoutConfirmed: false, entrepreneurPayoutAdminException: true })
    if (!published) await expect(page.getByRole('button', { name: 'Kinnita ettevõtluskonto kasutamine müüja andmetes' })).toHaveCount(0)
  })
}


test('a revoked admin exception restores the seller declaration in the open session', async ({ page }) => {
  await installSupabaseBackend(page, { ...store, is_published: false, settings: {
    ...store.settings, onboardingStep: 'business', sellerType: 'entrepreneur', sellerFirstName: 'Liisa', sellerLastName: 'Tamm',
    businessName: 'Liisa Tamm', registryCode: '', vatRegistered: false, entrepreneurPayoutConfirmed: false,
    entrepreneurPayoutAdminException: true,
  } }, { ...connectedStripeStatus, status: 'pending', payoutAdminException: false,
    setupError: 'Kinnita enda aktiivse ettevõtluskonto kasutamine müüja andmetes.' })
  await signInThroughLanding(page)
  await expect(page.getByRole('checkbox', { name: 'Kinnitan, et kasutan enda aktiivset LHV ettevõtluskontot', exact: false })).toBeVisible()
  await expect(page.getByText('Poeruumi administraator on sellele kontole teinud erandi.', { exact: false })).toHaveCount(0)
})
