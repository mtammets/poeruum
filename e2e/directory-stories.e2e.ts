import { expect, test } from '@playwright/test'
import { zodiacSigns } from '../supabase/functions/_shared/horoscope'

const directoryUrl = 'http://kaubamaja.localhost:4173'
const title = 'See üks tass, mille järele käsi haarab'

test('opens the story after the horoscope, supports direct visits, and returns to the directory', async ({ page }) => {
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
  await expect(stories.getByRole('img')).toHaveJSProperty('naturalWidth', 1536)
  await stories.getByRole('link', { name: `${title} Loe lugu` }).click()
  await expect(page).toHaveURL(`${directoryUrl}/lood/see-uks-tass/`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Enne sinu hommikut oli kellegi tööpäev' })).toBeVisible()
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://kaubamaja.poeruum.ee/lood/see-uks-tass/')
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article')
  await expect(page.locator('.directory-story-page__figure img')).toHaveJSProperty('naturalWidth', 1536)
  await page.reload()
  await expect(page).toHaveTitle(`${title} — Poeruumi lood`)
  await page.getByRole('link', { name: 'Tagasi Poeruumi lugude juurde' }).click()
  await expect(stories).toBeInViewport()
  await page.getByRole('searchbox').fill('olematu')
  await expect(stories).toHaveCount(0)
  await page.getByRole('searchbox').press('Escape')
  await expect(stories).toBeVisible()
})

test('the story remains readable on narrow screens and leads back to shops', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto(`${directoryUrl}/lood/see-uks-tass/`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.getByRole('link', { name: 'Avasta poode', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Leia oma uus lemmikpood' })).toBeInViewport()
  const stories = page.getByRole('region', { name: 'Poeruumi lood' })
  await stories.scrollIntoViewIfNeeded()
  await expect(stories.getByRole('link')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.goto(`${directoryUrl}/lood/puuduv-lugu/`)
  await expect(page.getByRole('heading', { name: 'Seda lugu ei leitud.' })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
})
