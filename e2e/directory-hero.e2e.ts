import { expect, test } from '@playwright/test'

const directoryUrl = 'http://kaubamaja.localhost:4173/'
const firstHeading = 'Avasta Poeruumis loodud Eesti e-poode'
const secondHeading = 'Too oma tooted nähtavale.'

test('hero rotates messages, preserves layout, and supports pause and selection', async ({ page }) => {
  await page.clock.install()
  await page.goto(directoryUrl)
  const heading = page.getByRole('heading', { level: 1 })
  const browse = page.locator('.store-directory__browse')
  await expect(page.getByRole('button', { name: 'Peata vahetumine' })).toBeEnabled()
  await page.evaluate(() => document.fonts.ready)
  await expect(heading).toHaveAccessibleName(firstHeading)
  await expect(browse).toHaveAccessibleName('Sirvi poode')
  await expect(browse).toHaveAttribute('href', '#store-directory-heading')
  const initialButtonBox = await browse.boundingBox()
  const initialHeroBox = await page.locator('.store-directory__hero').boundingBox()

  await page.clock.fastForward(7100)
  await expect(heading).toHaveAccessibleName(secondHeading)
  await expect(browse).toHaveAccessibleName('Loo oma e-pood')
  await expect(browse).toHaveAttribute('href', 'https://poeruum.ee/#hind')
  await expect(page.getByRole('button', { name: `Näita vaadet 2: ${secondHeading}` })).toHaveAttribute('aria-pressed', 'true')
  expect(await browse.boundingBox()).toEqual(initialButtonBox)
  expect(await page.locator('.store-directory__hero').boundingBox()).toEqual(initialHeroBox)

  await page.clock.fastForward(7100)
  await expect(heading).toHaveAccessibleName(firstHeading)
  await expect(browse).toHaveAccessibleName('Sirvi poode')
  await expect(browse).toHaveAttribute('href', '#store-directory-heading')

  await page.getByRole('button', { name: 'Peata vahetumine' }).click()
  await page.mouse.move(0, 0)
  await page.clock.fastForward(15000)
  await expect(heading).toHaveAccessibleName(firstHeading)
  await page.getByRole('button', { name: 'Jätka vahetumist' }).click()
  await page.mouse.move(0, 0)
  await page.clock.fastForward(7100)
  await expect(heading).toHaveAccessibleName(secondHeading)

  await page.getByRole('button', { name: `Näita vaadet 1: ${firstHeading}` }).click()
  await page.mouse.move(0, 0)
  await page.clock.fastForward(15000)
  await expect(heading).toHaveAccessibleName(firstHeading)
  await expect(page.getByRole('button', { name: 'Jätka vahetumist' })).toBeVisible()
})

test('hero stays still for reduced motion and both mobile slides fit without moving the browse link', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install()
  await page.goto(directoryUrl)
  const secondSlide = page.getByRole('button', { name: `Näita vaadet 2: ${secondHeading}` })
  await expect(secondSlide).toBeEnabled()
  await page.evaluate(() => document.fonts.ready)
  const browse = page.locator('.store-directory__browse')
  const initialBox = await browse.boundingBox()
  await page.clock.fastForward(15000)
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(firstHeading)
  await expect(page.getByRole('button', { name: 'Peata vahetumine' })).toHaveCount(0)
  await secondSlide.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(secondHeading)
  await expect(page.locator('.store-directory__hero-heading-slide.is-active')).toHaveCSS('transition-duration', '0s')
  await expect(page.locator('.store-directory__hero-description.is-active')).toHaveCSS('transition-duration', '0s')
  expect(await browse.boundingBox()).toEqual(initialBox)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.setViewportSize({ width: 320, height: 740 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

test('hero works without product photos and pauses for keyboard readers', async ({ page }) => {
  await page.clock.install()
  await page.goto(directoryUrl)
  await expect(page.locator('.store-directory__hero-media')).toHaveCount(0)
  await expect(page.locator('.store-directory__hero img')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Peata vahetumine' })).toBeEnabled()
  await page.getByRole('link', { name: 'Sirvi poode' }).focus()
  await page.clock.fastForward(15000)
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(firstHeading)
  await expect(page.getByRole('button', { name: 'Jätka vahetumist' })).toBeVisible()
})

test('hero shows one catalog photo at a time without any text on the photo', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await page.evaluate(async () => {
    const { mountDirectoryCatalogHarness } = await import('/e2e/directory-harness.tsx')
    mountDirectoryCatalogHarness(Array.from({ length: 4 }, (_, index) => ({
      store_id: `store-${index}`, store_name: `Pood ${index + 1}`, store_slug: `pood-${index + 1}`,
      primary_hostname: index === 1 ? 'custom.example.ee' : undefined,
      products: [
        { id: 'sold-out', name: 'Otsas', stock: 0, image_url: '/sold.webp', price: 5 },
        { id: 'hidden', name: 'Peidetud', search_visible: false, image_url: '/hidden.webp', price: 5 },
        { id: 'no-picture', name: 'Pildita', price: 5 },
        { id: `product-${index}`, name: `Toode ${index + 1}`, slug: `toode-${index + 1}`, stock: 1,
          image_url: `${window.location.origin}/images/poeruum-email-logo.png?product=${index}`, price: 30 },
      ],
    })))
  })
  const hero = page.locator('.store-directory__hero')
  const media = hero.locator('.store-directory__hero-media')
  const active = media.locator('.store-directory__hero-photo.is-active')
  await expect(media.locator('img')).toHaveCount(4)
  await expect(media).toHaveText('')
  await expect(media.getByRole('link')).toHaveCount(1)
  await expect.poll(() => media.locator('img').evaluateAll(images => images.every(image => image.naturalWidth > 0))).toBe(true)
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /poeruum-email-logo.png\?product=0$/)
  const initialBox = await media.boundingBox()
  for (const index of [1, 2, 3, 0]) {
    await page.clock.fastForward(7100)
    await expect(active.locator('img')).toHaveAttribute('src', new RegExp(`product=${index}$`))
    await expect(media.getByRole('link')).toHaveCount(1)
    expect(await media.boundingBox()).toEqual(initialBox)
  }
  await page.getByRole('button', { name: `Näita vaadet 2: ${secondHeading}` }).click()
  await expect(active).toHaveAttribute('href', 'https://custom.example.ee/toode/toode-2/?from=kaubamaja')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await expect(active).toBeVisible()
  }
  await page.route('https://custom.example.ee/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Toote leht</h1>' }))
  await active.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('https://custom.example.ee/toode/toode-2/?from=kaubamaja')
})
