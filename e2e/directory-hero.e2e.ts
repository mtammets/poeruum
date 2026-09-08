import { expect, test } from '@playwright/test'

const directoryUrl = 'http://kaubamaja.localhost:4173/'
const firstHeading = 'Avasta Poeruumis loodud Eesti e-poode'
const secondHeading = 'Too oma tooted nähtavale.'

test('hero rotates image and message together, preserves layout, and supports pause and selection', async ({ page }) => {
  await page.clock.install()
  await page.goto(directoryUrl)
  const heading = page.getByRole('heading', { level: 1 })
  const activeImage = page.locator('.store-directory__hero-image.is-active')
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
  await expect(activeImage).toHaveAttribute('src', '/images/poeruumi-kaubamaja-hero2.webp')
  await expect(page.getByRole('button', { name: `Näita vaadet 2: ${secondHeading}` })).toHaveAttribute('aria-pressed', 'true')
  expect(await browse.boundingBox()).toEqual(initialButtonBox)
  expect(await page.locator('.store-directory__hero').boundingBox()).toEqual(initialHeroBox)

  await page.clock.fastForward(7100)
  await expect(heading).toHaveAccessibleName(firstHeading)
  await expect(browse).toHaveAccessibleName('Sirvi poode')
  await expect(browse).toHaveAttribute('href', '#store-directory-heading')
  await expect(activeImage).toHaveAttribute('src', '/images/poeruumi-kaubamaja-hero.webp')

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
  await expect(page.locator('.store-directory__hero-image.is-active')).toHaveCSS('opacity', '1')
  await expect(page.locator('.store-directory__hero-image.is-active')).toHaveCSS('transition-duration', '0s')
  await expect(page.locator('.store-directory__hero-heading-slide.is-active')).toHaveCSS('transition-duration', '0s')
  await expect(page.locator('.store-directory__hero-description.is-active')).toHaveCSS('transition-duration', '0s')
  expect(await browse.boundingBox()).toEqual(initialBox)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.setViewportSize({ width: 320, height: 740 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

test('hero waits for its second image before rotating and pauses for keyboard readers', async ({ page }) => {
  await page.clock.install()
  let releaseImage!: () => void
  const imageGate = new Promise<void>((resolve) => { releaseImage = resolve })
  await page.route('**/poeruumi-kaubamaja-hero2.webp', async (route) => {
    await imageGate
    await route.continue()
  })
  await page.goto(directoryUrl, { waitUntil: 'domcontentloaded' })
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveAccessibleName(firstHeading)
  await page.clock.fastForward(15000)
  await expect(heading).toHaveAccessibleName(firstHeading)
  releaseImage()
  await expect(page.getByRole('button', { name: 'Peata vahetumine' })).toBeEnabled()
  await page.getByRole('link', { name: 'Sirvi poode' }).focus()
  await page.clock.fastForward(15000)
  await expect(heading).toHaveAccessibleName(firstHeading)
  await expect(page.getByRole('button', { name: 'Jätka vahetumist' })).toBeVisible()
})
