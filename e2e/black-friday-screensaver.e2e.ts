import { expect, test, type Page } from '@playwright/test'

test.use({ baseURL: 'http://kaubamaja.poeruum.localhost:4174' })

async function openCampaign(page: Page, theme = 'black-friday') {
  const storeId = '10000000-0000-4000-8000-000000000001'
  const product = { id: 'cap', name: 'Nokkmüts', slug: 'nokkmuts', price: 24.42, sale_price: 19.9,
    image_url: 'http://localhost:4174/storage/v1/object/public/product-images/cap.webp', stock: 5, search_visible: true }
  await page.route('**/storage/v1/object/public/product-images/cap.webp', route => route.fulfill({ path: 'public/images/campaigns/kruk-cap-cutout-v1.webp' }))
  await page.route('**/__e2e_supabase/**', route => {
    const path = new URL(route.request().url()).pathname
    let json: unknown = []
    if (path.endsWith('/rpc/get_directory_campaign')) json = { mode: 'on', revision: 1, startsAt: null, endsAt: null, serverNow: new Date().toISOString() }
    if (path.endsWith('/rpc/storefront_seo_catalog')) json = [{ store_id: storeId, store_name: 'Krük-Krük', store_slug: 'kruk-kruk', products: [product] }]
    if (path.endsWith('/products')) json = [product]
    if (path.endsWith('/public_storefronts')) json = {
      id: storeId, name: 'Krük-Krük', slug: 'kruk-kruk', is_published: true, payment_provider: 'stripe', payment_status: 'connected',
      settings: { deliverySettings: { parcelProviders: { omniva: { enabled: false, price: 0 }, dpd: { enabled: true, price: 2.9 }, smartposti: { enabled: false, price: 0 } },
        courierEnabled: false, courierPrice: 0, pickupEnabled: false, pickupAddress: '', freeShippingFrom: 50 } },
    }
    return route.fulfill({ json })
  })
  await page.clock.install()
  await page.goto(`/?theme=${theme}`)
  if (theme === 'black-friday') await expect(page.locator('#kruk-kruk .kruk-offer__buy')).toBeVisible()
}

const saver = (page: Page) => page.getByRole('dialog', { name: 'Rähni lennuvaade' })

test('waits a full minute after activity, hides all UI and restores scroll and focus', async ({ page }) => {
  await openCampaign(page)
  const buy = page.locator('#kruk-kruk .kruk-offer__buy')
  await buy.focus()
  await page.clock.runFor(100)
  const scrollY = await page.evaluate(() => window.scrollY)
  await page.clock.fastForward(59_000)
  await expect(saver(page)).toHaveCount(0)
  await page.mouse.move(10, 10)
  await page.clock.fastForward(59_000)
  await expect(saver(page)).toHaveCount(0)
  await page.clock.fastForward(1_001)
  await expect(saver(page)).toBeVisible()
  await expect(saver(page)).toHaveText('')
  await expect(page.locator('#root')).toHaveCSS('visibility', 'hidden')
  await expect(saver(page)).toHaveJSProperty('clientWidth', await page.evaluate(() => window.innerWidth))
  await page.mouse.move(20, 20)
  await expect(saver(page)).toHaveCount(0)
  await expect(page.locator('#root')).toHaveCSS('visibility', 'visible')
  await expect(buy).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
  await page.clock.fastForward(60_001)
  await expect(saver(page)).toBeVisible()
})

test('waking by keyboard, click or wheel does not activate the covered purchase button', async ({ page }) => {
  await openCampaign(page)
  const buy = page.locator('#kruk-kruk .kruk-offer__buy')
  await buy.focus()
  await page.clock.runFor(100)
  const bounds = (await buy.boundingBox())!
  await page.clock.fastForward(60_001)
  await expect(saver(page)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.clock.fastForward(60_001)
  await expect(saver(page)).toBeVisible()
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.clock.fastForward(60_001)
  await expect(saver(page)).toBeVisible()
  await page.mouse.wheel(0, 100)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('does not interrupt the hat view or checkout and resumes after they close', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCampaign(page)
  await page.getByRole('button', { name: 'Võta ratsaniku müts maha', exact: true }).click({ force: true })
  await expect(page.locator('.kruk-hat')).toBeVisible()
  await page.clock.fastForward(120_000)
  await expect(saver(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.kruk-hat')).toHaveCount(0)
  await page.locator('#kruk-kruk .kruk-offer__buy').click()
  await expect(page.getByRole('dialog', { name: 'Ostukorv' })).toBeVisible()
  await page.clock.fastForward(120_000)
  await expect(saver(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.clock.fastForward(60_001)
  await expect(saver(page)).toBeVisible()
})

test('hidden tabs close the saver and start a fresh minute on return', async ({ page }) => {
  await openCampaign(page)
  const visibility = (hidden: boolean) => page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, value })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
  await visibility(true)
  await page.clock.fastForward(180_000)
  await expect(saver(page)).toHaveCount(0)
  await visibility(false)
  await page.clock.fastForward(59_000)
  await expect(saver(page)).toHaveCount(0)
  await page.clock.fastForward(1_001)
  await expect(saver(page)).toBeVisible()
  await visibility(true)
  await expect(saver(page)).toHaveCount(0)
  await visibility(false)
  await expect(page.locator('#root')).toHaveCSS('visibility', 'visible')
})

test('flight has substantial depth and respects reduced motion', async ({ page }) => {
  await openCampaign(page)
  await page.clock.fastForward(60_001)
  const bird = saver(page).locator('.black-friday-screensaver__bird')
  await expect(bird).toBeVisible()
  await page.clock.runFor(10_000)
  const near = (await bird.boundingBox())!.width
  await page.clock.runFor(14_000)
  const far = (await bird.boundingBox())!.width
  expect(near).toBeGreaterThan(far * 2.5)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(bird).toHaveCSS('animation-name', 'none')
  await expect(saver(page).locator('.banner-forest__track').first()).toHaveCSS('animation-name', 'none')
  await page.keyboard.press('Escape')
  await expect(saver(page)).toHaveCount(0)
})

test('arrows control speed and depth together without waking or scrolling the directory', async ({ page }) => {
  await openCampaign(page)
  const buy = page.locator('#kruk-kruk .kruk-offer__buy')
  await buy.focus()
  await page.clock.runFor(100)
  const scrollY = await page.evaluate(() => window.scrollY)
  await page.clock.fastForward(60_001)
  const bird = saver(page).locator('.black-friday-screensaver__bird')
  const forest = saver(page).locator('.banner-forest__track').first()
  const rate = () => forest.evaluate(element => element.getAnimations()[0].playbackRate)
  await page.keyboard.down('ArrowLeft')
  await page.keyboard.down('ArrowDown')
  await page.clock.runFor(5_000)
  await expect(saver(page)).toBeVisible()
  await expect.poll(rate).toBeGreaterThan(3)
  const near = (await bird.boundingBox())!.width
  await page.keyboard.up('ArrowDown')
  await page.keyboard.up('ArrowLeft')
  const boosted = await rate()
  await page.clock.runFor(1_000)
  expect(await rate()).toBeGreaterThan(1.5)
  expect(await rate()).toBeLessThan(boosted)
  await page.keyboard.down('ArrowRight')
  await page.keyboard.down('ArrowUp')
  await page.clock.runFor(7_000)
  await page.keyboard.up('ArrowUp')
  await page.keyboard.up('ArrowRight')
  await expect.poll(rate).toBeLessThan(.5)
  expect(near / (await bird.boundingBox())!.width).toBeGreaterThan(2.5)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
  await page.keyboard.press('Escape')
  await expect(saver(page)).toHaveCount(0)
  await expect(buy).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
})

test('losing focus releases held controls and a new flight starts with no stuck keys', async ({ page }) => {
  await openCampaign(page)
  await page.clock.fastForward(60_001)
  await page.keyboard.down('ArrowLeft')
  await page.clock.runFor(3_000)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.clock.runFor(10_000)
  const rate = () => saver(page).locator('.banner-forest__track').first().evaluate(element => element.getAnimations()[0].playbackRate)
  await expect.poll(rate).toBeLessThan(1.2)
  await page.keyboard.up('ArrowLeft')
  await page.keyboard.press('Escape')
  await page.clock.fastForward(60_001)
  await expect(saver(page)).toBeVisible()
  await expect.poll(rate).toBeLessThan(1.2)
})

test('reduced motion allows deliberate depth steps without continuing to animate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCampaign(page)
  await page.clock.fastForward(60_001)
  const bird = saver(page).locator('.black-friday-screensaver__bird')
  const before = (await bird.boundingBox())!.width
  await page.keyboard.press('ArrowDown')
  const near = await bird.boundingBox()
  expect(near!.width).toBeGreaterThan(before)
  await page.clock.runFor(10_000)
  expect(await bird.boundingBox()).toEqual(near)
  await page.keyboard.press('ArrowUp')
  expect((await bird.boundingBox())!.width).toBeCloseTo(before, 2)
  await expect(saver(page).locator('.banner-forest__track').first()).toHaveCSS('animation-name', 'none')
  await page.keyboard.press('Escape')
  await expect(saver(page)).toHaveCount(0)
})

test('the ordinary directory has no campaign screensaver', async ({ page }) => {
  await openCampaign(page, 'default')
  await page.clock.fastForward(120_000)
  await expect(saver(page)).toHaveCount(0)
  await expect(page.locator('#root')).toHaveCSS('visibility', 'visible')
})

test.describe('touchscreen', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
  test('fills the phone screen and a tap restores the page without opening checkout', async ({ page }) => {
    await openCampaign(page)
    await page.clock.fastForward(60_001)
    await expect(saver(page)).toBeVisible()
    const bounds = (await saver(page).boundingBox())!
    expect(bounds).toMatchObject({ x: 0, y: 0, width: 390, height: 844 })
    await page.touchscreen.tap(200, 700)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('#root')).toHaveCSS('visibility', 'visible')
  })
})
