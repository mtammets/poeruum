import { expect, test } from '@playwright/test'
import { zodiacSigns } from '../supabase/functions/_shared/horoscope'

const entries = Object.fromEntries(zodiacSigns.map((sign) => [sign.id,
  `${sign.name}: üks pooleli jäänud mõte võib täna lõpuks paika loksuda. Räägi sellest sõbraga ja vaata, kuhu jutt teid viib.`,
]))

test('horoscope selection persists and stays usable on mobile', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-07T10:00:00Z') })
  await page.route('**/data/daily-horoscope.json', (route) => route.fulfill({ json: { date: '2026-09-07', entries } }))
  await page.goto('http://kaubamaja.localhost:4173/')
  const section = page.getByRole('region', { name: 'Päevahoroskoop' })
  const select = section.getByRole('combobox', { name: 'Tähemärk' })
  await expect(select).toHaveValue('aries')
  for (const sign of zodiacSigns) {
    await select.selectOption(sign.id)
    await expect(section.locator('p')).toHaveText(entries[sign.id])
  }
  await page.reload()
  await expect(select).toHaveValue('pisces')
  await page.setViewportSize({ width: 390, height: 844 })
  await select.scrollIntoViewIfNeeded()
  await expect(select).toBeInViewport()
  expect((await select.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('an open page hides yesterday and loads a newly available edition after Tallinn midnight', async ({ page }) => {
  let date = '2026-09-07'
  await page.clock.install({ time: new Date('2026-09-07T20:59:30Z') })
  await page.route('**/data/daily-horoscope.json', (route) => route.fulfill({ json: { date, entries } }))
  await page.goto('http://kaubamaja.localhost:4173/')
  const section = page.getByRole('region', { name: 'Päevahoroskoop' })
  await expect(section.locator('time')).toHaveAttribute('datetime', '2026-09-07')
  await page.clock.fastForward(61_000)
  await expect(section).toHaveCount(0)
  date = '2026-09-08'
  await page.clock.fastForward(61_000)
  await expect(section.locator('time')).toHaveAttribute('datetime', '2026-09-08')
})
