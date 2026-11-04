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
const birdButton = (page: Page) => page.getByRole('button', { name: 'Alusta rähnimängu', exact: true })

test('points update on each catch, only carried hats are delivered, and the level returns to the real store', async ({ page }) => {
  test.setTimeout(90_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCampaign(page)
  await birdButton(page).press('Enter')
  const dialog = saver(page)
  await expect(dialog.locator('.hat-delivery__photograph')).toHaveJSProperty('complete', true)
  await page.clock.runFor(3_300)
  await expect(dialog.locator('.hat-delivery__total')).toHaveText('1')
  // One caught hat is thrown away. It must never become a delivered hat.
  await page.keyboard.press('ArrowRight')
  await page.clock.runFor(700)
  await expect(dialog.locator('.hat-flight__cargo image')).toHaveCount(0)
  await page.clock.runFor(28_500)
  await expect(dialog).toHaveAttribute('data-level-phase', 'approaching')
  const carried = await dialog.locator('.hat-flight__cargo image').count()
  const points = (await dialog.getAttribute('data-caught'))!
  expect(Number(points)).toBeGreaterThan(carried)
  expect(carried).toBeGreaterThan(0)
  await expect(dialog.locator('.hat-delivery__total')).toHaveText(points)
  // Arrival has taken over the controls; cargo cannot be lost in the doorway.
  await page.keyboard.press('ArrowRight')
  await page.clock.runFor(6_200)
  await expect(dialog).toHaveAttribute('data-level-phase', 'entering')
  await expect(dialog.locator('.hat-flight__cargo image')).toHaveCount(carried)
  await expect(dialog.locator('.hat-delivery__facade')).toHaveCSS('visibility', 'visible')
  await expect(dialog.locator('.hat-delivery__total')).toHaveText(points)
  await page.clock.runFor(3_500)
  await expect(dialog).toHaveAttribute('data-level-phase', 'delivered')
  await expect(dialog.locator('.hat-delivery__total')).toHaveText(points)
  await expect(dialog.locator('.hat-flight__cargo image')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('poeruum:woodpecker:delivered:v1'))).toBe(String(carried))
  await page.clock.runFor(3_200)
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#store-directory-heading')).toBeFocused()
  await page.reload()
  await birdButton(page).press('Enter')
  await expect(saver(page).locator('.hat-delivery__total')).toHaveText('0')
  await expect(saver(page)).toHaveAttribute('data-level-phase', 'collecting')
})

test('arrival fits a rotated phone and cancelling before delivery awards nothing', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCampaign(page)
  await birdButton(page).press('Enter')
  const dialog = saver(page)
  await expect(dialog.locator('.hat-delivery__photograph')).toHaveJSProperty('complete', true)
  await page.clock.runFor(34_000)
  await expect(dialog).toHaveAttribute('data-level-phase', 'approaching')
  await page.setViewportSize({ width: 844, height: 390 })
  await page.clock.runFor(3_000)
  const photograph = await dialog.locator('.hat-delivery__photograph').boundingBox()
  expect(photograph!.x + photograph!.width * .85).toBeGreaterThan(0)
  expect(photograph!.x + photograph!.width * .85).toBeLessThan(844)
  expect(photograph!.y + photograph!.height * .8).toBeLessThan(390)
  const counter = await dialog.locator('.hat-delivery__counter').boundingBox()
  expect(counter!.x).toBeGreaterThanOrEqual(0)
  expect(counter!.y + counter!.height).toBeLessThan(390)
  await page.keyboard.press('Escape')
  await page.clock.runFor(10_000)
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('poeruum:woodpecker:delivered:v1'))).toBe(null)
  await birdButton(page).press('Enter')
  await expect(saver(page).locator('.hat-delivery__total')).toHaveText('0')
})

test('pressing the bird plays the current call and opens a flight that stays open until dismissed', async ({ page }) => {
  await openCampaign(page)
  await page.addStyleTag({ content: '.black-friday-banner__arrival { animation: none !important; translate: none !important; rotate: none !important; scale: 1 !important; }' })
  const sound = page.locator('.black-friday-banner audio')
  await birdButton(page).click()
  await expect(saver(page)).toBeVisible()
  await expect(sound).toHaveAttribute('src', '/audio/campaigns/musta-rahni-call-1.mp3')
  await expect(sound).toHaveJSProperty('paused', false)
  await expect.poll(() => saver(page).locator('.woodpecker-beak').evaluate(beak =>
    Number(beak.getAttribute('transform')?.match(/rotate\(([-.\d]+)/)?.[1] || 0))).toBeLessThan(-1)
  await page.mouse.move(4, 4)
  await expect(saver(page)).toBeVisible()
  await expect.poll(() => sound.evaluate(audio => audio.ended)).toBe(true)
  await expect(saver(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(saver(page)).toHaveCount(0)
  await expect(birdButton(page)).toBeFocused()

  await birdButton(page).press('Enter')
  await expect(saver(page)).toBeVisible()
  await expect(sound).toHaveAttribute('src', '/audio/campaigns/musta-rahni-call-2.mp3')
  await expect(sound).toHaveJSProperty('paused', false)
  await page.keyboard.press('Escape')
  await expect(saver(page)).toHaveCount(0)
  await expect(sound).toHaveJSProperty('paused', true)
  await page.clock.fastForward(60_001)
  await expect(saver(page)).toBeVisible()
  await expect(sound).toHaveJSProperty('paused', true)
})

test('the bird still opens the flight if audio cannot load', async ({ page }) => {
  await page.route('**/audio/campaigns/musta-rahni-call-1.mp3', route => route.abort())
  await openCampaign(page)
  await birdButton(page).press('Enter')
  await expect(saver(page)).toBeVisible()
  await expect.poll(() => page.locator('.black-friday-banner audio').evaluate(audio => audio.error !== null)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(saver(page)).toHaveCount(0)
  await expect(birdButton(page)).toBeFocused()
})

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
  await expect(saver(page).locator('.black-friday-screensaver__flight')).toHaveText('')
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
  await page.keyboard.down('ArrowUp')
  await page.clock.runFor(2_200)
  await expect.poll(rate).toBeLessThan(1.4)
  await page.keyboard.down('ArrowLeft')
  await page.clock.runFor(4_800)
  await page.keyboard.up('ArrowUp')
  await expect.poll(rate).toBeGreaterThan(2.8)
  expect(near / (await bird.boundingBox())!.width).toBeGreaterThan(2.5)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
  await page.keyboard.press('Escape')
  await expect(saver(page)).toHaveCount(0)
  await expect(buy).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
})

test('manual flight keeps the original speed and depth controls and closes explicitly', async ({ page }) => {
  await openCampaign(page)
  await birdButton(page).press('Enter')
  const dialog = saver(page)
  const bird = dialog.locator('.black-friday-screensaver__bird')
  const rate = () => dialog.locator('.banner-forest__track').first().evaluate(element => element.getAnimations()[0].playbackRate)
  await expect(dialog.locator('.black-friday-screensaver__flight')).toHaveText('')
  await expect(dialog.getByRole('button', { name: 'Sulge mäng' })).toBeVisible()
  await expect(dialog.locator('.black-friday-screensaver__controls')).toBeHidden()
  await expect(dialog.locator('.black-friday-screensaver__hint')).toBeVisible()
  await page.keyboard.down('ArrowLeft')
  await page.keyboard.down('ArrowDown')
  await page.clock.runFor(5_000)
  const near = (await bird.boundingBox())!.width
  await expect.poll(rate).toBeGreaterThan(3)
  await page.keyboard.up('ArrowDown')
  await page.keyboard.up('ArrowLeft')
  await page.keyboard.down('ArrowUp')
  await page.clock.runFor(2_200)
  await expect.poll(rate).toBeLessThan(1.4)
  await page.keyboard.down('ArrowLeft')
  await page.clock.runFor(4_800)
  await page.keyboard.up('ArrowUp')
  await expect.poll(rate).toBeGreaterThan(2.8)
  expect(near / (await bird.boundingBox())!.width).toBeGreaterThan(2.5)
  const beforePointer = await bird.boundingBox()
  await page.mouse.move(10, 10)
  await expect(dialog).toBeVisible()
  // Pointer movement has no steering handler.
  expect(Math.abs((await bird.boundingBox())!.x - beforePointer!.x)).toBeLessThan(10)
  await page.mouse.click(10, 10)
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Sulge mäng' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(birdButton(page)).toBeFocused()
})

test('caps in the nearer flight lane appear larger than caps farther away', async ({ page }) => {
  await openCampaign(page)
  await birdButton(page).press('Enter')
  await page.keyboard.down('ArrowLeft')
  await page.keyboard.down('ArrowDown')
  await page.clock.runFor(6_800)
  await page.keyboard.up('ArrowDown')
  await page.keyboard.up('ArrowLeft')
  const far = saver(page).locator('.hat-flight__hat[data-depth="0.150"][data-caught="false"]')
  const near = saver(page).locator('.hat-flight__hat[data-depth="0.650"][data-caught="false"]')
  await expect(far).toBeVisible()
  await expect(near).toBeVisible()
  expect((await near.boundingBox())!.width).toBeGreaterThan((await far.boundingBox())!.width * 1.5)
  await expect(saver(page).locator('.black-friday-screensaver__flight')).toHaveText('')
  await page.keyboard.press('Escape')
})

test('wings beat gently on autopilot, more strongly under thrust, and respect reduced motion', async ({ page }) => {
  await openCampaign(page)
  await birdButton(page).press('Enter')
  const wings = saver(page).locator('.woodpecker-wing')
  await expect(wings).toHaveCount(2)
  const sample = async () => {
    const angles: number[][] = []
    for (let i = 0; i < 12; i++) {
      await page.clock.runFor(150)
      angles.push(await wings.evaluateAll(elements => elements.map(element =>
        Math.abs(parseFloat((element as SVGSVGElement).style.transform.match(/rotate\(([-.\d]+)/)?.[1] || '0')))))
    }
    return [0, 1].map(wing => Math.max(...angles.map(frame => frame[wing])))
  }
  const glide = await sample()
  expect(Math.min(...glide)).toBeGreaterThan(1)
  await page.keyboard.down('ArrowLeft')
  await page.clock.runFor(1_000)
  const powered = await sample()
  powered.forEach((angle, wing) => expect(angle).toBeGreaterThan(glide[wing] * 1.5))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.runFor(2_000)
  await expect(wings.nth(0)).toHaveCSS('transform', 'none')
  await expect(wings.nth(1)).toHaveCSS('transform', 'none')
  await expect(saver(page).locator('.black-friday-screensaver__flight')).toHaveText('')
  await page.keyboard.press('Escape')
})

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`forward must stay held and can restore height before falling out at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await openCampaign(page)
    await birdButton(page).press('Enter')
    const dialog = saver(page)
    const bird = dialog.locator('.black-friday-screensaver__bird')
    const rate = () => dialog.locator('.banner-forest__track').first().evaluate(element => element.getAnimations()[0].playbackRate)
    await expect.poll(rate).toBeGreaterThan(1.45)
    // Hold forward while taking over from the automatic depth orbit.
    await page.keyboard.down('ArrowLeft')
    await page.clock.runFor(1_500)
    const centerY = async () => { const box = (await bird.boundingBox())!; return box.y + box.height / 2 }
    const level = await centerY()
    await page.keyboard.up('ArrowLeft')
    await page.clock.runFor(200)
    expect(await centerY() - level).toBeGreaterThan(0)
    expect(await centerY() - level).toBeLessThan(viewport.height * .03)
    await page.clock.runFor(1_900)
    const fallen = await centerY()
    expect(fallen - level).toBeGreaterThan(viewport.height * .2)
    expect(await bird.evaluate(element => parseFloat(element.style.rotate))).toBeLessThan(-10)
    await page.keyboard.down('ArrowLeft')
    await page.clock.runFor(6_000)
    expect(fallen - await centerY()).toBeGreaterThan(viewport.height * .2)
    expect(Math.abs(await centerY() - level)).toBeLessThan(viewport.height * .05)
    await expect(dialog.locator('.black-friday-screensaver__flight')).toHaveText('')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test(`the whole bird falls out before the scene and sound close at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(() => {
      const probe = { top: 0, closedAudio: 0, music: [] as HTMLMediaElement[] }
      Object.assign(window, { fallExitProbe: probe })
      const close = HTMLDialogElement.prototype.close
      HTMLDialogElement.prototype.close = function (...args) {
        if (this.open && this.matches('.black-friday-screensaver')) {
          probe.top = this.querySelector('.black-friday-screensaver__bird')!.getBoundingClientRect().top
        }
        return close.apply(this, args)
      }
      const create = AudioContext.prototype.createMediaElementSource
      AudioContext.prototype.createMediaElementSource = function (element) {
        probe.music.push(element)
        return create.call(this, element)
      }
      const closeAudio = AudioContext.prototype.close
      AudioContext.prototype.close = function () {
        return closeAudio.call(this).then(() => { probe.closedAudio++ })
      }
    })
    await openCampaign(page)
    await birdButton(page).press('Enter')
    const probe = () => page.evaluate(() => {
      const value = (window as Window & { fallExitProbe: { top: number; closedAudio: number; music: HTMLMediaElement[] } }).fallExitProbe
      return { top: value.top, closed: value.closedAudio, playing: value.music.some(audio => !audio.paused),
        loaded: value.music.some(audio => audio.readyState > 0) }
    })
    await expect.poll(async () => (await probe()).playing).toBe(true)
    // Taking over depth without forward thrust starts a gradual descent.
    await page.keyboard.down(viewport.width === 1280 ? 'ArrowDown' : 'ArrowUp')
    await page.clock.runFor(600)
    await expect(saver(page)).toBeVisible()
    await page.clock.runFor(8_000)
    await expect(saver(page)).toHaveCount(0)
    expect((await probe()).top).toBeGreaterThanOrEqual(viewport.height)
    await expect.poll(async () => (await probe()).closed).toBe(1)
    expect((await probe()).playing).toBe(false)
    expect((await probe()).loaded).toBe(false)
    await expect(birdButton(page)).toBeFocused()
    await page.keyboard.up(viewport.width === 1280 ? 'ArrowDown' : 'ArrowUp')
    await birdButton(page).press('Enter')
    // A new scene starts in autonomous flight until another steering input.
    await page.clock.runFor(12_000)
    await expect(saver(page)).toBeVisible()
    await expect(saver(page).locator('.black-friday-screensaver__flight')).toHaveText('')
    await page.keyboard.press('Escape')
  })
}

test('toes catch a cap, then release it with the back arrow while forward flight continues', async ({ page }) => {
  await openCampaign(page)
  await birdButton(page).press('Enter')
  // Keep assertion/locator round trips from advancing the 120 ms release on CI.
  // Only runFor advances the scene while we inspect the opening toes and cap.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100))
  await page.keyboard.down('ArrowLeft')
  await page.clock.runFor(120)
  const foot = saver(page).locator('.woodpecker-claws')
  await expect(foot).toHaveAttribute('data-grip', 'resting')
  let reached = false
  for (let i = 0; i < 40; i++) {
    await page.clock.runFor(80)
    if (await foot.getAttribute('data-grip') === 'reaching') { reached = true; break }
  }
  expect(reached).toBe(true)
  await expect(saver(page).locator('.hat-flight__collected')).toHaveCount(0)
  const angle = (selector: string) => foot.locator(selector).evaluate(e => Number(e.getAttribute('transform')!.match(/rotate\(([-.\d]+)/)![1]))
  expect(await angle('.woodpecker-claws__rear')).toBeLessThan(-1)
  expect(await angle('.woodpecker-claws__front')).toBeGreaterThan(1)
  await page.clock.runFor(1_500)
  await expect(foot).toHaveAttribute('data-grip', 'holding')
  await expect(foot.locator('.hat-flight__collected')).toHaveCount(1)
  expect(await angle('.woodpecker-claws__front')).toBeCloseTo(14, 1)
  const rate = () => saver(page).locator('.banner-forest__track').first().evaluate(element => element.getAnimations()[0].playbackRate)
  const bird = saver(page).locator('.black-friday-screensaver__bird')
  const level = (await bird.boundingBox())!
  const beforeRate = await rate()
  await page.keyboard.down('ArrowRight')
  await page.clock.runFor(80)
  await expect(foot).toHaveAttribute('data-grip', 'releasing')
  expect(await angle('.woodpecker-claws__front')).toBeGreaterThan(25)
  const held = (await foot.locator('.hat-flight__collected image').boundingBox())!
  await page.clock.runFor(64)
  await expect(foot.locator('.hat-flight__collected')).toHaveCount(0)
  const drop = saver(page).locator('.hat-flight__drop')
  await expect(drop).toHaveCount(1)
  const released = (await drop.boundingBox())!
  expect(Math.abs(released.x + released.width / 2 - held.x - held.width / 2)).toBeLessThan(5)
  expect(Math.abs(released.y + released.height / 2 - held.y - held.height / 2)).toBeLessThan(5)
  await page.clock.runFor(300)
  const falling = (await drop.boundingBox())!
  expect(falling.y + falling.height / 2 - released.y - released.height / 2).toBeGreaterThan(10)
  expect(await rate()).toBeGreaterThanOrEqual(beforeRate - .02)
  const flying = (await bird.boundingBox())!
  expect(Math.abs(flying.y + flying.height / 2 - level.y - level.height / 2)).toBeLessThan(10)
  // Holding the release key must not keep creating caps.
  await page.keyboard.down('ArrowRight')
  await page.clock.runFor(2_000)
  await expect(drop).toHaveCount(0)
  await page.keyboard.up('ArrowRight')
  await expect(saver(page).locator('.black-friday-screensaver__flight')).toHaveText('')
  await page.keyboard.press('Escape')
  await expect(saver(page)).toHaveCount(0)
})

test('releasing cargo leaves autopilot alone and new catches start a fresh carried stack', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCampaign(page)
  await birdButton(page).press('Enter')
  await page.clock.runFor(3_300)
  const dialog = saver(page)
  const bird = dialog.locator('.black-friday-screensaver__bird')
  const caps = dialog.locator('.hat-flight__collected')
  await expect(caps).toHaveCount(1)
  const pose = await bird.boundingBox()
  await page.keyboard.down('ArrowRight')
  await page.clock.runFor(700)
  await expect(caps).toHaveCount(0)
  await expect(dialog.locator('.hat-flight__drop')).toHaveCount(1)
  expect(await bird.boundingBox()).toEqual(pose)
  await page.keyboard.down('ArrowLeft')
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp')
  await page.clock.runFor(2_400)
  await expect(dialog).toHaveAttribute('data-caught', '2')
  await expect(caps).toHaveCount(1)
  await expect(dialog.locator('.hat-flight__drop')).toHaveCount(0)
  await page.keyboard.down('ArrowRight') // repeat while still held
  await page.clock.runFor(180)
  await expect(caps).toHaveCount(1)
  await page.keyboard.up('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.clock.runFor(180)
  await expect(caps).toHaveCount(0)
  await expect(dialog.locator('.hat-flight__drop')).toHaveCount(1)
  await expect(dialog.locator('.black-friday-screensaver__flight')).toHaveText('')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('background music starts on entry, ducks for a catch, loops and releases on exit', async ({ page }) => {
  let musicRequests = 0
  page.on('request', request => { if (request.url().includes('musta-rahni-flight-music.mp3')) musicRequests++ })
  await page.addInitScript(() => {
    const tracks: { element: HTMLMediaElement; gain?: GainNode }[] = []
    Object.assign(window, { flightMusicProbe: tracks })
    const create = AudioContext.prototype.createMediaElementSource
    AudioContext.prototype.createMediaElementSource = function (element) {
      const source = create.call(this, element)
      const entry: { element: HTMLMediaElement; gain?: GainNode } = { element }
      tracks.push(entry)
      const connect = source.connect.bind(source)
      source.connect = ((destination: AudioNode) => {
        if (destination instanceof GainNode) entry.gain = destination
        return connect(destination)
      }) as typeof source.connect
      return source
    }
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCampaign(page)
  expect(musicRequests).toBe(0)
  await birdButton(page).press('Enter')
  const music = () => page.evaluate(() => {
    const tracks = (window as Window & { flightMusicProbe?: { element: HTMLMediaElement; gain?: GainNode }[] }).flightMusicProbe!
    const current = tracks.at(-1)!
    return { tracks: tracks.length, active: tracks.filter(t => !t.element.paused).length,
      playing: !current.element.paused, time: current.element.currentTime, duration: current.element.duration,
      loop: current.element.loop, level: current.gain?.gain.value ?? 0, src: current.element.getAttribute('src'),
      ready: current.element.readyState, network: current.element.networkState }
  })
  await expect.poll(async () => (await music()).time).toBeGreaterThan(0)
  expect((await music()).loop).toBe(true)
  await expect.poll(async () => (await music()).level).toBeGreaterThan(.3)
  await page.clock.runFor(3_300)
  await expect(saver(page)).toHaveAttribute('data-caught', '1')
  await expect.poll(async () => (await music()).level).toBeLessThan(.22)
  await expect.poll(async () => (await music()).level).toBeGreaterThan(.3)
  await page.evaluate(() => {
    const tracks = (window as Window & { flightMusicProbe?: { element: HTMLMediaElement }[] }).flightMusicProbe!
    const element = tracks.at(-1)!.element
    element.currentTime = element.duration - .15
  })
  await expect.poll(async () => (await music()).time).toBeLessThan(1)
  expect((await music()).playing).toBe(true)
  await page.keyboard.press('ArrowLeft')
  expect((await music()).tracks).toBe(1)
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await music()).active).toBe(0)
  expect((await music()).src).toBeNull()
  // Chromium retains currentSrc after load(); the empty media/network states
  // verify that the decoder and network resource were actually released.
  await expect.poll(async () => (await music()).ready).toBe(0)
  await expect.poll(async () => (await music()).network).toBe(0)
  await birdButton(page).press('Enter')
  await expect.poll(async () => (await music()).time).toBeGreaterThan(0)
  expect((await music()).tracks).toBe(2)
  expect((await music()).active).toBe(1)
  await expect(saver(page).locator('.black-friday-screensaver__flight')).toHaveText('')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await music()).active).toBe(0)
})

test('catches attach to the real claws, play each current call, and stop sound on exit', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = { decoded: 0, calls: [] as number[], closed: 0 }
    Object.assign(window, { flightAudioProbe: probe })
    const decode = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = function (data: ArrayBuffer) {
      return decode.call(this, data).then(buffer => { probe.decoded++; return buffer })
    }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      if (this.buffer && !this.loop) probe.calls.push(this.buffer.duration)
      return start.apply(this, args)
    }
    const close = AudioContext.prototype.close
    AudioContext.prototype.close = function () {
      return close.call(this).then(() => { probe.closed++ })
    }
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCampaign(page)
  await birdButton(page).press('Enter')
  const probe = () => page.evaluate(() => (window as Window & { flightAudioProbe?: { decoded: number; calls: number[]; closed: number } }).flightAudioProbe!)
  await expect.poll(async () => (await probe()).decoded).toBe(2)
  await page.clock.runFor(3_300)
  await expect(saver(page)).toHaveAttribute('data-caught', '1')
  await expect(saver(page).locator('.hat-flight__collected')).toHaveCount(1)
  expect((await probe()).calls[0]).toBeCloseTo(1.071, 2)
  // Keep forward held while moving back in depth to meet the second hat.
  await page.keyboard.down('ArrowLeft')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.clock.runFor(3_000)
  await expect(saver(page)).toHaveAttribute('data-caught', '2')
  await expect(saver(page).locator('.hat-flight__collected')).toHaveCount(2)
  const calls = (await probe()).calls
  expect(calls).toHaveLength(2)
  expect(calls[1]).toBeCloseTo(2.82125, 2)
  await expect(saver(page).locator('.black-friday-screensaver__flight')).toHaveText('')
  await page.keyboard.press('Escape')
  await expect(saver(page)).toHaveCount(0)
  await expect.poll(async () => (await probe()).closed).toBe(1)
})

test('losing focus releases held controls and a new flight starts with no stuck keys', async ({ page }) => {
  await openCampaign(page)
  await page.clock.fastForward(60_001)
  await page.keyboard.down('ArrowLeft')
  await page.clock.runFor(3_000)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  // Losing focus releases forward; the bird descends and the scene ends.
  await page.clock.runFor(10_000)
  await expect(saver(page)).toHaveCount(0)
  const rate = () => saver(page).locator('.banner-forest__track').first().evaluate(element => element.getAnimations()[0].playbackRate)
  await page.keyboard.up('ArrowLeft')
  await page.clock.fastForward(60_001)
  await expect(saver(page)).toBeVisible()
  await expect.poll(rate).toBeGreaterThan(1.45)
  await expect.poll(rate).toBeLessThan(1.9)
})

test('reduced motion keeps depth steps steady while forward is held', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCampaign(page)
  await page.clock.fastForward(60_001)
  const bird = saver(page).locator('.black-friday-screensaver__bird')
  await page.keyboard.down('ArrowLeft')
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
  test('tapping the game label starts flight, background taps keep it open and Close returns to the page', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openCampaign(page)
    const sound = page.locator('.black-friday-banner audio')
    await expect(page.locator('.black-friday-banner__game-note')).toBeVisible()
    await page.locator('.black-friday-banner__game-title').tap()
    await expect(saver(page)).toBeVisible()
    await expect(sound).toHaveJSProperty('paused', false)
    await expect(saver(page).locator('.woodpecker-beak')).toHaveAttribute('transform', 'rotate(0.00 265 490)')
    await page.touchscreen.tap(200, 700)
    await expect(saver(page)).toBeVisible()
    await expect(saver(page).getByRole('button', { name: 'Lenda: hoia all' })).toBeVisible()
    await page.clock.runFor(3_300)
    await expect(saver(page).locator('.hat-flight__collected')).toHaveCount(1)
    await saver(page).getByRole('button', { name: 'Vabasta mütsid' }).tap()
    await page.clock.runFor(700)
    await expect(saver(page).locator('.hat-flight__collected')).toHaveCount(0)
    await expect(saver(page).locator('.hat-flight__drop')).toHaveCount(1)
    await saver(page).getByRole('button', { name: 'Sulge mäng' }).tap()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(sound).toHaveJSProperty('paused', true)
    await expect(page.locator('#root')).toHaveCSS('visibility', 'visible')
  })

  test('two fingers control thrust and depth independently; cancellation releases thrust', async ({ page, context }) => {
    await openCampaign(page)
    // Keep the label still while tapping; game physics stays animated.
    await page.addStyleTag({ content: '.black-friday-banner__arrival { animation: none !important; translate: none !important; rotate: none !important; scale: 1 !important; }' })
    await page.locator('.black-friday-banner__game-title').tap()
    const dialog = saver(page)
    const thrust = dialog.getByRole('button', { name: 'Lenda: hoia all' })
    const near = dialog.getByRole('button', { name: 'Lenda lähemale' })
    const hint = dialog.locator('.black-friday-screensaver__hint')
    await expect(hint).toBeVisible()
    const center = async (button: ReturnType<Page['locator']>, id: number) => {
      const box = (await button.boundingBox())!
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, id }
    }
    const left = await center(thrust, 1)
    const down = await center(near, 2)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left] })
    await expect(thrust).toHaveAttribute('data-pressed', 'true')
    await expect(hint).toContainText('Kaugemale')
    await expect(hint).toContainText('Lähemale')
    await expect(hint).toContainText('Vabasta mütsid')
    await expect(hint).not.toHaveAttribute('data-dismissed', 'true')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left, down] })
    await expect(near).toHaveAttribute('data-pressed', 'true')
    const bird = dialog.locator('.black-friday-screensaver__bird')
    const before = (await bird.boundingBox())!.width
    await page.clock.runFor(3_000)
    expect((await bird.boundingBox())!.width).toBeGreaterThan(before * 1.3)
    const rate = () => dialog.locator('.banner-forest__track').first().evaluate(element => element.getAnimations()[0].playbackRate)
    expect(await rate()).toBeGreaterThan(3)
    // CDP lists the fingers being lifted, not the fingers remaining on screen.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [down] })
    await expect(near).toHaveAttribute('data-pressed', 'false')
    await expect(thrust).toHaveAttribute('data-pressed', 'true')
    await page.clock.runFor(1_000)
    expect(await rate()).toBeGreaterThan(3)
    // A finger slipping outside the button keeps its capture until cancellation.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...left, x: 160, y: 400 }] })
    await expect(thrust).toHaveAttribute('data-pressed', 'true')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await expect(thrust).toHaveAttribute('data-pressed', 'false')
    const level = (await bird.boundingBox())!.y
    await page.clock.runFor(1_800)
    expect((await bird.boundingBox())!.y).toBeGreaterThan(level + 60)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Sulge mäng' }).tap()
    await expect(dialog).toHaveCount(0)
    await cdp.detach()
  })

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
