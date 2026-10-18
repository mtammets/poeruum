import { expect, test } from '@playwright/test'
import { zodiacSigns } from '../supabase/functions/_shared/horoscope'

const directoryUrl = 'http://kaubamaja.poeruum.localhost:4174'
const title = 'Lugu savitöökojast'
const story = {
  slug: 'test-tookoja-lugu', title, category: 'Poeruumi lood', author: 'Liis', publishedAt: '2026-10-18',
  intro: 'Esimesest kruusist oma töökojani.', image: '/images/kaubamaja-example-ceramics.webp', imageAlt: 'Keraamika', imageCaption: '',
  opening: ['Kõik algas ühest kruusist.', 'Liis õppis savi vormima oma köögilaua taga. Iga uus katsetus õpetas talle midagi juurde.'],
  quote: 'Iga ese sünnib oma tempos.',
  sections: [{ title: 'Esimene tellimus', paragraphs: ['Esimese tellimuse tegi naaber. Ta soovis kruusi, millest hommikuti kohvi juua.'] },
    { title: 'Oma töökoda', paragraphs: ['Aasta hiljem kolis Liis väikesesse töökotta. Seal on ruumi proovida uusi kujusid ja glasuure.'] }],
}
const newestStory = { ...story, slug: 'uusim-tookoja-lugu', title: 'Savist sünnib midagi päris oma',
  author: 'Liis Tamm', imageCaption: 'Foto: Liisi erakogu', storeName: 'Liisi Savipood', storeSlug: 'liisi-savipood', publishedAt: '2026-10-19' }

test.beforeEach(async ({ page }) => {
  await page.route('**/__e2e_supabase/**', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname.endsWith('/directory_stories')) {
      expect(url.searchParams.get('is_published')).toBe('eq.true')
      const slug = url.searchParams.get('slug')
      return route.fulfill({ headers, json: slug ? slug === `eq.${story.slug}` ? { story } : null : [{ story: newestStory }, { story }] })
    }
    return route.fulfill({ headers, json: url.pathname.endsWith('/platform_settings') ? null : [] })
  })
})

test('the newest story replaces the carousel and expands inline without stretching its photo', async ({ page }) => {
  await page.clock.install()
  await page.goto(directoryUrl)
  const hero = page.locator('.directory-story-hero')
  const toggle = hero.getByRole('button', { name: 'Loe edasi', exact: true })
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText(newestStory.title)
  await expect(hero.locator('.directory-story-hero__byline')).toHaveText(newestStory.storeName)
  await expect(page.getByRole('group', { name: 'Avaosa vaated' })).toHaveCount(0)
  await expect(hero.getByRole('link', { name: 'Külasta poodi' })).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(() => hero.getByRole('img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await page.evaluate(() => document.fonts.ready)
  const measureHeader = () => hero.evaluate(element => {
    const origin = element.getBoundingClientRect()
    return ['.directory-story-hero__figure img', '.directory-story-hero__intro'].map(selector => {
      const box = element.querySelector(selector)!.getBoundingClientRect()
      return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }
    })
  })
  const headerLayout = await measureHeader()
  const initialHeight = (await hero.boundingBox())!.height
  await page.clock.fastForward(22000)
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText(newestStory.title)
  await expect(page.locator('.directory-stories')).not.toContainText(newestStory.title)
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', `https://kaubamaja.poeruum.ee${newestStory.image}`)
  await page.screenshot({ path: 'output/directory-story-hero-desktop.png', fullPage: false })

  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(hero.locator('.directory-story-hero__intro').getByRole('button')).toHaveCount(0)
  await expect(hero.getByRole('heading', { name: 'Esimene tellimus' })).toBeVisible()
  await expect.poll(async () => (await hero.boundingBox())!.height).toBeGreaterThan(initialHeight + 300)
  await expect.poll(async () => Math.abs((await hero.locator('.directory-story-hero__expansion').boundingBox())!.y)).toBeLessThanOrEqual(1)
  await expect(hero.locator('.directory-story-page__body > p').first()).toBeInViewport({ ratio: 1 })
  await expect(hero.locator('.directory-story-hero__expansion')).toBeFocused()
  expect(await measureHeader()).toEqual(headerLayout)
  await expect(hero.getByRole('link', { name: 'Külasta poodi' })).toHaveAttribute('href', 'https://liisi-savipood.poeruum.ee/?from=kaubamaja')
  await expect(page).toHaveURL(`${directoryUrl}/`)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: 'output/directory-story-hero-expanded.png', fullPage: true })
  await hero.locator('.directory-story-hero__end').getByRole('button', { name: 'Tagasi', exact: true }).click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
  await expect(hero.getByRole('heading', { level: 1 })).toBeInViewport()
  await expect.poll(async () => Math.round((await hero.boundingBox())!.height)).toBe(Math.round(initialHeight))
})

for (const width of [1440, 390]) {
  test(`the green header closes the story and returns to its opening at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(directoryUrl)
    const hero = page.locator('.directory-story-hero')
    const header = hero.locator('.directory-story-hero__preview')
    const toggle = hero.getByRole('button', { name: 'Loe edasi', exact: true })
    for (const target of ['background', 'heading', 'keyboard']) {
      await expect(header.locator('.directory-story-hero__header-close')).toHaveCount(0)
      await toggle.click()
      await expect.poll(async () => Math.abs((await hero.locator('.directory-story-hero__expansion').boundingBox())!.y)).toBeLessThanOrEqual(1)
      await hero.locator('.directory-story-page__body > p').first().click()
      await expect(hero).toHaveClass(/is-expanded/)
      if (target === 'background') await header.click({ position: { x: 8, y: 64 } })
      else if (target === 'heading') {
        await header.locator('h1').evaluate(element => {
          const range = document.createRange()
          range.selectNodeContents(element)
          window.getSelection()?.removeAllRanges()
          window.getSelection()?.addRange(range)
        })
        expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(newestStory.title)
        await header.locator('h1').dispatchEvent('click')
        await expect(hero).toHaveClass(/is-expanded/)
        await page.evaluate(() => window.getSelection()?.removeAllRanges())
        await header.locator('h1').click()
      } else {
        await header.getByRole('button', { name: 'Tagasi', exact: true }).focus()
        await page.keyboard.press('Space')
      }
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(toggle).toBeFocused()
      await expect(hero.getByRole('heading', { level: 1 })).toBeInViewport()
      await expect(hero.locator('.directory-story-hero__expansion')).toHaveAttribute('aria-hidden', 'true')
    }
  })

  test(`clicking beside the story closes it and outside controls keep their focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(directoryUrl)
    const hero = page.locator('.directory-story-hero')
    const toggle = hero.getByRole('button', { name: 'Loe edasi', exact: true })
    await toggle.click()
    await expect.poll(async () => Math.abs((await hero.locator('.directory-story-hero__expansion').boundingBox())!.y)).toBeLessThanOrEqual(1)
    await page.mouse.click(4, 450)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toBeFocused()
    await expect(hero.getByRole('heading', { level: 1 })).toBeInViewport()
    await toggle.click()
    await expect.poll(async () => Math.abs((await hero.locator('.directory-story-hero__expansion').boundingBox())!.y)).toBeLessThanOrEqual(1)
    await hero.locator('.directory-story-hero__full-story').click({ position: { x: 8, y: 100 } })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toBeFocused()
    await toggle.click()
    await expect.poll(async () => Math.abs((await hero.locator('.directory-story-hero__expansion').boundingBox())!.y)).toBeLessThanOrEqual(1)
    const search = page.getByRole('searchbox')
    await search.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(search).toBeFocused()
    await search.pressSequentially('savi')
    await expect(search).toHaveValue('savi')
  })
}

test.describe('touch interaction', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  test('tapping beside the article or on its green header closes it', async ({ page }) => {
    await page.goto(directoryUrl)
    const hero = page.locator('.directory-story-hero')
    const toggle = hero.getByRole('button', { name: 'Loe edasi', exact: true })
    for (const target of ['outside', 'header']) {
      await toggle.tap()
      await expect.poll(async () => Math.abs((await hero.locator('.directory-story-hero__expansion').boundingBox())!.y)).toBeLessThanOrEqual(1)
      if (target === 'outside') await page.touchscreen.tap(4, 400)
      else await hero.locator('.directory-story-hero__preview').tap({ position: { x: 8, y: 64 } })
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(toggle).toBeFocused()
    }
  })
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
test(`the interview scrolls to its opening and closes on narrow screens (${reducedMotion})`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(directoryUrl)
    const hero = page.locator('.directory-story-hero')
    await expect(hero.getByRole('button', { name: 'Loe edasi' })).toBeVisible()
    const imageBox = (await hero.getByRole('img').boundingBox())!
    const titleBox = (await hero.getByRole('heading', { level: 1 }).boundingBox())!
    expect(imageBox.y + imageBox.height).toBeLessThan(titleBox.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (width === 390) await page.screenshot({ path: 'output/directory-story-hero-mobile.png', fullPage: true })
    await hero.getByRole('button', { name: 'Loe edasi' }).click()
    if (reducedMotion === 'reduce') await expect(hero.locator('.directory-story-hero__expansion')).toHaveCSS('transition-duration', '0s')
    await expect(hero.getByRole('heading', { name: 'Oma töökoda' })).toBeVisible()
    await expect.poll(async () => Math.abs((await hero.locator('.directory-story-hero__expansion').boundingBox())!.y)).toBeLessThanOrEqual(1)
    await expect(hero.locator('.directory-story-page__body > p').first()).toBeInViewport({ ratio: 1 })
    expect((await hero.getByRole('img').boundingBox())!.height).toBe(imageBox.height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await hero.locator('.directory-story-hero__close').click()
    await expect(hero.getByRole('button', { name: 'Loe edasi' })).toBeFocused()
    await expect(hero.getByRole('heading', { level: 1 })).toBeInViewport()
    await hero.getByRole('button', { name: 'Loe edasi' }).click()
    await expect(hero.locator('.directory-story-hero__intro').getByRole('button')).toHaveCount(0)
    await expect.poll(async () => Math.abs((await hero.locator('.directory-story-hero__expansion').boundingBox())!.y)).toBeLessThanOrEqual(1)
    await hero.locator('.directory-story-hero__close').click()
    await expect(hero.getByRole('button', { name: 'Loe edasi' })).toHaveAttribute('aria-expanded', 'false')
  }
})
}

test('a single story handles the stories anchor and archive pagination keeps the newest story in the hero', async ({ page }) => {
  let count = 1
  const catalog = Array.from({ length: 14 }, (_, index) => ({ ...story, slug: `lugu-${index}`, title: `Kaupmehe lugu ${index}` }))
  await page.route('**/__e2e_supabase/rest/v1/directory_stories?**', (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('order')).toBe('published_at.desc,id.desc')
    const offset = Number(url.searchParams.get('offset') || 0)
    const limit = Number(url.searchParams.get('limit') || 12)
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: catalog.slice(0, count).slice(offset, offset + limit).map(story => ({ story })) })
  })
  await page.goto(`${directoryUrl}/#poeruumi-lood`)
  await expect(page.locator('.directory-story-hero')).toBeInViewport()
  await expect(page.locator('.directory-stories')).toHaveCount(0)
  count = 14
  await page.goto(directoryUrl)
  await expect(page.locator('.directory-stories__feature')).toHaveCount(11)
  await page.getByRole('button', { name: 'Veel lugusid' }).click()
  await expect(page.locator('.directory-stories__feature')).toHaveCount(13)
  await expect(page.getByRole('button', { name: 'Veel lugusid' })).toHaveCount(0)
  await expect(page.locator('.directory-story-hero h1')).toHaveText(catalog[0].title)
  await expect(page.locator('.directory-stories')).not.toContainText(catalog[0].title)
  await page.getByRole('searchbox').fill('olematu')
  await expect(page.locator('.directory-stories')).toHaveCount(0)
  await page.getByRole('searchbox').press('Escape')
  await expect(page.locator('.directory-stories__feature')).toHaveCount(13)
})

test('opens stories over the directory and preserves scroll, focus and browser history', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-07T10:00:00Z') })
  const entries = Object.fromEntries(zodiacSigns.map((sign) => [sign.id,
    'Üks pooleli jäänud mõte võib täna lõpuks paika loksuda. Räägi sellest sõbraga ja vaata, kuhu jutt teid viib.',
  ]))
  await page.route('**/data/daily-horoscope.json', (route) => route.fulfill({ json: { date: '2026-09-07', entries } }))
  await page.goto(directoryUrl)
  const stories = page.getByRole('region', { name: 'Poeruumi lood' })
  await expect(stories).toBeVisible()
  await expect(page.locator('.daily-horoscope + #poeruumi-lood')).toBeVisible()
  await stories.scrollIntoViewIfNeeded()
  await expect.poll(() => stories.getByRole('img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const card = stories.getByRole('link', { name: `${title} Loe lugu` })
  await expect(card).toHaveAttribute('href', `/lood/${story.slug}/`)
  await card.scrollIntoViewIfNeeded()
  const scrollY = await page.evaluate(() => window.scrollY)
  const documentCreatedAt = await page.evaluate(() => performance.timeOrigin)
  await card.click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(`${directoryUrl}/`)
  await expect(dialog.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Sulge', exact: true })).toBeFocused()
  await page.screenshot({ path: 'output/directory-story-dialog-desktop.png' })
  await page.keyboard.press('Tab')
  await expect(dialog.locator('.directory-story-dialog__content')).toBeFocused()
  await page.keyboard.press('PageDown')
  await expect.poll(() => dialog.locator('.directory-story-dialog__content').evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await dialog.getByRole('heading', { name: 'Esimene tellimus' }).scrollIntoViewIfNeeded()
  await expect(dialog.getByRole('button', { name: 'Sulge', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(card).toBeFocused()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY)
  await page.goForward()
  await expect(dialog).toBeVisible()
  await page.goBack()
  await expect(dialog).toHaveCount(0)
  await expect(card).toBeFocused()
  await card.click()
  await dialog.getByRole('button', { name: 'Sulge', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await card.click()
  await page.mouse.click(4, 4)
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentCreatedAt)
  await page.getByRole('searchbox').fill('olematu')
  await expect(stories).toHaveCount(0)
  await page.getByRole('searchbox').press('Escape')
  await expect(stories).toBeVisible()
})

test('direct article links keep their own page and metadata', async ({ page }) => {
  await page.goto(`${directoryUrl}/lood/${story.slug}/`)
  await expect(page).toHaveURL(`${directoryUrl}/lood/${story.slug}/`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Esimene tellimus' })).toBeVisible()
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://kaubamaja.poeruum.ee/lood/${story.slug}/`)
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article')
  await expect.poll(() => page.locator('.directory-story-page__figure img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await page.reload()
  await expect(page).toHaveTitle(`${title} — Poeruumi lood`)
  await page.getByRole('link', { name: 'Tagasi Poeruumi lugude juurde' }).click()
  await expect(page.getByRole('region', { name: 'Poeruumi lood' })).toBeInViewport()
})

test('an empty directory has no story section and the removed editorial article is unavailable', async ({ page }) => {
  await page.route('**/__e2e_supabase/rest/v1/directory_stories?**', (route) => route.fulfill({
    headers: { 'Access-Control-Allow-Origin': '*' }, json: new URL(route.request().url()).searchParams.has('slug') ? null : [],
  }))
  await page.goto(directoryUrl)
  await expect(page.getByRole('heading', { name: 'Leia oma uus lemmikpood' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Poeruumi lood' })).toHaveCount(0)
  await page.goto(`${directoryUrl}/lood/see-uks-tass/`)
  await expect(page.getByRole('heading', { name: 'Seda lugu ei leitud.' })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
})

test('the story remains readable on narrow screens and returns to the directory', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto(`${directoryUrl}/lood/${story.slug}/`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.getByRole('link', { name: 'Tagasi Poeruumi lugude juurde' }).click()
  const stories = page.getByRole('region', { name: 'Poeruumi lood' })
  await stories.scrollIntoViewIfNeeded()
  await expect(stories.getByRole('link')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  const documentCreatedAt = await page.evaluate(() => performance.timeOrigin)
  await stories.getByRole('link', { name: `${title} Loe lugu` }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(`${directoryUrl}/#poeruumi-lood`)
  expect(await dialog.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(320)
  await page.screenshot({ path: 'output/directory-story-dialog-mobile.png' })
  await dialog.getByRole('heading', { name: 'Oma töökoda' }).scrollIntoViewIfNeeded()
  await expect(dialog.getByRole('button', { name: 'Sulge', exact: true })).toBeInViewport()
  await dialog.getByRole('button', { name: 'Sulge', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(stories.getByRole('link', { name: `${title} Loe lugu` })).toBeInViewport()
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentCreatedAt)
  await page.goto(`${directoryUrl}/lood/puuduv-lugu/`)
  await expect(page.getByRole('heading', { name: 'Seda lugu ei leitud.' })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
})
