import { expect, test } from '@playwright/test'
import { zodiacSigns } from '../supabase/functions/_shared/horoscope'

const entries = Object.fromEntries(zodiacSigns.map((sign) => [sign.id,
  `${sign.name}: üks pooleli jäänud mõte võib täna lõpuks paika loksuda. Räägi sellest sõbraga ja vaata, kuhu jutt teid viib.`,
]))

test('horoscope selection persists and stays usable on mobile', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-07T10:00:00Z') })
  await page.route('**/data/daily-horoscope.json', (route) => route.fulfill({ json: { date: '2026-09-07', entries } }))
  await page.goto('http://kaubamaja.localhost:4173/')
  const section = page.getByRole('region', { name: 'Horoskoop', exact: true })
  const signs = section.getByRole('radiogroup', { name: 'Vali tähemärk' })
  await expect(signs.getByRole('radio')).toHaveCount(12)
  await expect(signs.getByRole('radio', { name: 'Jäär', exact: true })).toBeChecked()
  for (const sign of zodiacSigns) {
    await signs.getByRole('radio', { name: sign.name, exact: true }).check()
    await expect(section.getByRole('heading', { level: 3 })).toHaveText(sign.name)
    await expect(section.locator('p')).toHaveText(entries[sign.id])
  }
  await page.reload()
  const pisces = signs.getByRole('radio', { name: 'Kalad', exact: true })
  await expect(pisces).toBeChecked()
  await expect(section.getByRole('heading', { level: 3 })).toHaveText('Kalad')
  await pisces.focus()
  await page.keyboard.press('ArrowRight')
  await expect(signs.getByRole('radio', { name: 'Jäär', exact: true })).toBeChecked()
  await expect(section.getByRole('heading', { level: 3 })).toHaveText('Jäär')
  await expect(section.locator('p')).toHaveText(entries.aries)
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await signs.scrollIntoViewIfNeeded()
    for (const sign of zodiacSigns) {
      const radio = signs.getByRole('radio', { name: sign.name, exact: true })
      await expect(radio).toBeInViewport()
      expect((await radio.boundingBox())?.height).toBeGreaterThanOrEqual(44)
      expect((await radio.boundingBox())?.width).toBeGreaterThanOrEqual(44)
    }
    await signs.getByRole('radio', { name: 'Veevalaja', exact: true }).check()
    await expect(section.getByRole('heading', { level: 3 })).toHaveText('Veevalaja')
    await expect(section.locator('p')).toHaveText(entries.aquarius)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
})

test('an open page keeps the section visible and replaces yesterday after Tallinn midnight', async ({ page }) => {
  let date = '2026-09-07'
  await page.clock.install({ time: new Date('2026-09-07T20:59:30Z') })
  await page.route('**/data/daily-horoscope.json', (route) => route.fulfill({ json: { date, entries } }))
  await page.goto('http://kaubamaja.localhost:4173/')
  const section = page.getByRole('region', { name: 'Horoskoop', exact: true })
  await expect(section.locator('time')).toHaveAttribute('datetime', '2026-09-07')
  await section.getByRole('radio', { name: 'Sõnn', exact: true }).check()
  await expect(section.locator('p')).toHaveText(entries.taurus)
  await page.clock.fastForward(61_000)
  await expect(section).toBeVisible()
  await expect(section.locator('time')).toHaveAttribute('datetime', '2026-09-08')
  await expect(section.locator('p')).toHaveText('Tänane horoskoop pole veel saadaval. Vaata mõne aja pärast uuesti.')
  date = '2026-09-08'
  await page.clock.fastForward(61_000)
  await expect(section.locator('time')).toHaveAttribute('datetime', '2026-09-08')
  await expect(section.locator('p')).toHaveText(entries.taurus)
  await expect(section.getByRole('radio', { name: 'Sõnn', exact: true })).toBeChecked()
})
