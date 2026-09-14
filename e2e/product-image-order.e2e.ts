import { expect, test, type Page } from '@playwright/test'

const gallery = ['first', 'second', 'third'].map((name) => `http://localhost:4174/storage/v1/object/public/product-images/10000000-0000-4000-8000-000000000093/${name}.svg`)
const transforms = {
  [gallery[0]]: { x: 4, y: 8, scale: 2 },
  [gallery[1]]: { x: -5, y: 3, scale: 1.5 },
  [gallery[2]]: { x: 9, y: -2, scale: 2.5 },
}
const tray = '.product-image-editor__tray'
const item = '.product-image-editor__item'
const thumbnail = '.product-image-editor__preview'

async function openEditor(page: Page) {
  let product = {
    id: 'image-order-product', store_id: '10000000-0000-4000-8000-000000000093',
    name: 'Espresso tass', alt: 'Espresso tass', description: 'Käsitööna valminud tass.', price: 20,
    image_url: gallery[0], gallery, image_transforms: transforms, search_visible: true,
  }
  const saves: typeof product[] = []
  await page.route('**/storage/v1/object/public/product-images/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#92785b"/></svg>' }))
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
  const loaded = page.waitForResponse((response) => response.url().includes('/rest/v1/products'))
  await page.evaluate(async ({ gallery, transforms }) => {
    const { mountProductImageOrderHarness } = await import('/e2e/product-image-order-harness.tsx')
    mountProductImageOrderHarness({ id: 'image-order-product', name: 'Espresso tass', alt: 'Espresso tass', description: 'Käsitööna valminud tass.', price: 20, image: gallery[0], gallery, imageTransforms: transforms })
  }, { gallery, transforms })
  await loaded
  await page.getByRole('button', { name: 'Muuda toodet' }).click()
  await expect(page.locator(thumbnail)).toHaveCount(3)
  return saves
}

async function order(page: Page) {
  return page.locator(`${tray} ${item} img`).evaluateAll((images) => images.map((image) => image.getAttribute('src')))
}

async function dragPhoto(page: Page, from: number, to: number) {
  const source = (await page.locator(thumbnail).nth(from).boundingBox())!
  const target = (await page.locator(thumbnail).nth(to).boundingBox())!
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
  await page.mouse.up()
}

test('reorders any photo, saves the cover and preserves every crop when reopening', async ({ page }) => {
  const saves = await openEditor(page)
  const first = (await page.locator(`${item} img`).nth(0).boundingBox())!
  const second = (await page.locator(`${item} img`).nth(1).boundingBox())!
  expect(first.width).toBeGreaterThan(second.width)
  await dragPhoto(page, 2, 0)
  await expect.poll(() => order(page)).toEqual([gallery[2], gallery[0], gallery[1]])
  const preview = page.locator('.story-slide img[fetchpriority="high"]')
  await expect(preview).toHaveAttribute('src', gallery[2])
  await expect(preview).toHaveAttribute('style', /scale\(2.5\)/)
  await dragPhoto(page, 1, 2)
  await expect.poll(() => order(page)).toEqual([gallery[2], gallery[1], gallery[0]])
  await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
  await expect(page.getByRole('button', { name: 'Muuda toodet' })).toBeVisible()
  expect(saves[0]).toMatchObject({ image_url: gallery[2], gallery: [gallery[2], gallery[1], gallery[0]], image_transforms: transforms })
  await page.getByRole('button', { name: 'Muuda toodet' }).click()
  await expect.poll(() => order(page)).toEqual([gallery[2], gallery[1], gallery[0]])
  await page.getByRole('button', { name: 'Vali pilt 3', exact: true }).click()
  await expect(preview).toHaveAttribute('src', gallery[0])
  await expect(preview).toHaveAttribute('style', /scale\(2\)/)
})

test('supports keyboard order, preserves selection for secondary photos and discards edits', async ({ page }) => {
  const saves = await openEditor(page)
  await page.getByRole('button', { name: 'Vali pilt 2', exact: true }).click()
  await page.locator(thumbnail).nth(1).focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => order(page)).toEqual([gallery[0], gallery[2], gallery[1]])
  await expect(page.locator('.story-slide img[fetchpriority="high"]')).toHaveAttribute('src', gallery[1])
  await expect(page.locator(thumbnail).nth(2)).toBeFocused()
  await page.keyboard.press('Home')
  await expect.poll(() => order(page)).toEqual([gallery[1], gallery[0], gallery[2]])
  await page.getByRole('button', { name: 'Loobu muudatustest' }).click()
  await page.getByRole('button', { name: 'Muuda toodet' }).click()
  await expect.poll(() => order(page)).toEqual(gallery)
  expect(saves).toHaveLength(0)
})

test('reorders using touch without scrolling and restores the original order on touch cancellation', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openEditor(page)
  const cdp = await context.newCDPSession(page)
  const source = (await page.locator(thumbnail).nth(2).boundingBox())!
  const target = (await page.locator(thumbnail).nth(0).boundingBox())!
  const y = source.y + source.height / 2
  const startX = source.x + source.width / 2
  const endX = target.x + target.width / 2
  const scrollY = await page.evaluate(() => window.scrollY)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] })
  for (let step = 1; step <= 10; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + (endX - startX) * step / 10, y }] })
  }
  await expect.poll(() => order(page)).toEqual([gallery[2], gallery[0], gallery[1]])
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect.poll(() => order(page)).toEqual(gallery)
  await expect(page.locator('.story-slide img[fetchpriority="high"]')).toHaveAttribute('src', gallery[0])
  await expect.poll(() => page.locator(tray).evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: endX, y }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => order(page)).toEqual([gallery[2], gallery[0], gallery[1]])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect.poll(() => page.locator(tray).evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0)
  const boxes = await page.locator(`${item} img`).evaluateAll((images) => images.map((image) => ({ left: image.getBoundingClientRect().left, right: image.getBoundingClientRect().right })))
  expect(boxes[0].right).toBeLessThan(boxes[1].left)
  expect(boxes[1].right).toBeLessThan(boxes[2].left)
  await page.screenshot({ path: '/tmp/poeruum-image-order-mobile.png' })
})


test('keeps image controls usable after reordering and disables sorting for a single photo', async ({ page }) => {
  const saves = await openEditor(page)
  await dragPhoto(page, 2, 0)
  await page.getByRole('button', { name: 'Eemalda pilt 1', exact: true }).click()
  await expect.poll(() => order(page)).toEqual([gallery[0], gallery[1]])
  await page.getByRole('button', { name: 'Vali pilt 2', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Vaheta valitud pilt' })).toBeVisible()
  await page.getByRole('button', { name: 'Eemalda pilt 2', exact: true }).click()
  await expect(page.locator(`${thumbnail}.is-sortable`)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Lisa pilt', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
  await expect(page.getByRole('button', { name: 'Muuda toodet' })).toBeVisible()
  expect(saves[0]).toMatchObject({ image_url: gallery[0], gallery: [gallery[0]], image_transforms: { [gallery[0]]: transforms[gallery[0]] } })
})

test('distinguishes a tap with slight movement from dragging an unselected photo', async ({ page }) => {
  await openEditor(page)
  const preview = page.locator('.story-slide img[fetchpriority="high"]')
  const photo = (await page.locator(thumbnail).nth(2).boundingBox())!
  await page.mouse.move(photo.x + photo.width / 2, photo.y + photo.height / 2)
  await page.mouse.down()
  await page.mouse.move(photo.x + photo.width / 2 + 4, photo.y + photo.height / 2)
  await page.mouse.up()
  await expect(preview).toHaveAttribute('src', gallery[2])
  await expect.poll(() => order(page)).toEqual(gallery)
  await page.locator(thumbnail).nth(0).click()
  await dragPhoto(page, 1, 2)
  await expect.poll(() => order(page)).toEqual([gallery[0], gallery[2], gallery[1]])
  await expect(preview).toHaveAttribute('src', gallery[0])
  await page.locator(thumbnail).nth(1).click()
  await expect(preview).toHaveAttribute('src', gallery[2])
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Vaheta valitud pilt' }).click()
  await chooser
  await expect.poll(() => order(page)).toEqual([gallery[0], gallery[2], gallery[1]])
})

test('keeps control of a touch drag that initially moves vertically before moving to the first photo', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openEditor(page)
  const cdp = await context.newCDPSession(page)
  const source = (await page.locator(thumbnail).nth(2).boundingBox())!
  const target = (await page.locator(thumbnail).nth(0).boundingBox())!
  const startX = source.x + source.width / 2
  const startY = source.y + source.height / 2
  const endX = target.x + target.width / 2
  const scrollY = await page.evaluate(() => window.scrollY)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] })
  // Fingers rarely follow the perfectly horizontal path of the original test.
  for (let step = 1; step <= 4; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX - step, y: startY - step * 6 }] })
  }
  for (let step = 1; step <= 10; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + (endX - startX) * step / 10, y: startY - 24 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => order(page)).toEqual([gallery[2], gallery[0], gallery[1]])
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
})
