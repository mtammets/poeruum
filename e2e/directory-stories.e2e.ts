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

test.beforeEach(async ({ page }) => {
  await page.route('**/__e2e_supabase/**', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname.endsWith('/directory_stories')) {
      expect(url.searchParams.get('is_published')).toBe('eq.true')
      const slug = url.searchParams.get('slug')
      return route.fulfill({ headers, json: slug ? slug === `eq.${story.slug}` ? { story } : null : [{ story }] })
    }
    return route.fulfill({ headers, json: url.pathname.endsWith('/platform_settings') ? null : [] })
  })
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

test('the story remains readable on narrow screens and leads back to shops', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto(`${directoryUrl}/lood/${story.slug}/`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.getByRole('link', { name: 'Avasta poode', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Leia oma uus lemmikpood' })).toBeInViewport()
  const stories = page.getByRole('region', { name: 'Poeruumi lood' })
  await stories.scrollIntoViewIfNeeded()
  await expect(stories.getByRole('link')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  const documentCreatedAt = await page.evaluate(() => performance.timeOrigin)
  await stories.getByRole('link', { name: `${title} Loe lugu` }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(`${directoryUrl}/#store-directory-heading`)
  expect(await dialog.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(320)
  await page.screenshot({ path: 'output/directory-story-dialog-mobile.png' })
  await dialog.getByRole('link', { name: 'Avasta poode', exact: true }).scrollIntoViewIfNeeded()
  await expect(dialog.getByRole('button', { name: 'Sulge', exact: true })).toBeInViewport()
  await dialog.getByRole('link', { name: 'Avasta poode', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Leia oma uus lemmikpood' })).toBeInViewport()
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentCreatedAt)
  await page.goto(`${directoryUrl}/lood/puuduv-lugu/`)
  await expect(page.getByRole('heading', { name: 'Seda lugu ei leitud.' })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
})
