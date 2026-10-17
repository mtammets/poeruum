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
  await expect(section.getByRole('button', { name: 'Jaga', exact: true })).toBeDisabled()
  date = '2026-09-08'
  await page.clock.fastForward(61_000)
  await expect(section.locator('time')).toHaveAttribute('datetime', '2026-09-08')
  await expect(section.locator('p')).toHaveText(entries.taurus)
  await expect(section.getByRole('radio', { name: 'Sõnn', exact: true })).toBeChecked()
  await expect(section.getByRole('button', { name: 'Jaga', exact: true })).toBeEnabled()
})

test('shares a link to the selected horoscope through the native share menu', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-07T10:00:00Z') })
  await page.route('**/data/daily-horoscope.json', (route) => route.fulfill({ json: { date: '2026-09-07', entries } }))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: async (data: ShareData) => {
      sessionStorage.setItem('shared-horoscope', JSON.stringify(data))
    } })
  })
  await page.goto('http://kaubamaja.localhost:4173/?utm_source=test#store-directory-heading')
  const section = page.getByRole('region', { name: 'Horoskoop', exact: true })
  await section.getByRole('radio', { name: 'Sõnn', exact: true }).check()
  await section.getByRole('button', { name: 'Jaga', exact: true }).click()
  const shared = await page.evaluate(() => JSON.parse(sessionStorage.getItem('shared-horoscope') || '{}'))
  expect(shared.url).toBe('http://kaubamaja.localhost:4173/?horoskoop=taurus#horoskoop')
  expect(shared.title).toContain('Sõnn · 7. september')
  expect(shared.text).toBeUndefined()
  await section.getByRole('radio', { name: 'Lõvi', exact: true }).check()
  await section.getByRole('button', { name: 'Jaga', exact: true }).click()
  const next = await page.evaluate(() => JSON.parse(sessionStorage.getItem('shared-horoscope') || '{}'))
  expect(next.url).toBe('http://kaubamaja.localhost:4173/?horoskoop=leo#horoskoop')
  expect(next.title).toContain('Lõvi')
  expect(next.text).toBeUndefined()
})

test('copies a link without opening native sharing and opens the shared sign over a saved preference', async ({ page, context }) => {
  const origin = 'http://kaubamaja.localhost:4173'
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  await page.clock.install({ time: new Date('2026-09-07T10:00:00Z') })
  await page.route('**/data/daily-horoscope.json', (route) => route.fulfill({ json: { date: '2026-09-07', entries } }))
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: async () => {
    sessionStorage.setItem('native-share-opened', 'true')
  } }))
  await page.goto(origin)
  const section = page.getByRole('region', { name: 'Horoskoop', exact: true })
  await section.getByRole('radio', { name: 'Sõnn', exact: true }).check()
  await page.setViewportSize({ width: 320, height: 740 })
  await section.getByRole('button', { name: 'Kopeeri link', exact: true }).click()
  await expect(section.getByRole('button', { name: 'Link kopeeritud', exact: true })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('native-share-opened'))).toBeNull()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  const url = await page.evaluate(() => navigator.clipboard.readText())
  expect(url).toBe(`${origin}/?horoskoop=taurus#horoskoop`)

  await section.getByRole('radio', { name: 'Kalad', exact: true }).check()
  await page.goto(url)
  await expect(section.getByRole('radio', { name: 'Sõnn', exact: true })).toBeChecked()
  await expect(section.getByRole('heading', { level: 3 })).toHaveText('Sõnn')
  await expect(section.locator('p')).toHaveText(entries.taurus)
  await expect(section.getByRole('heading', { level: 2 })).toBeInViewport({ ratio: 1 })
  await expect(page).toHaveTitle('Sõnn · tänane horoskoop — Poeruumi Kaubamaja')
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://kaubamaja.poeruum.ee/?horoskoop=taurus')
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://kaubamaja.poeruum.ee/images/horoscope/taurus.png')
  await expect(section.getByRole('radiogroup')).toBeInViewport({ ratio: 1 })
  await expect(section.getByRole('heading', { level: 3 })).toBeInViewport()
  await expect(section.locator('p')).toBeInViewport({ ratio: 1 })
  expect(await page.evaluate(() => localStorage.getItem('poeruum:horoscope-sign'))).toBe('pisces')
  await page.setViewportSize({ width: 1440, height: 900 })
  // Preview services can drop the fragment; the sign alone still opens the full block.
  await page.goto(url.split('#')[0])
  await expect(section).toBeInViewport({ ratio: 1 })
  await section.getByRole('radio', { name: 'Vähk', exact: true }).check()
  await page.reload()
  await expect(section.getByRole('radio', { name: 'Vähk', exact: true })).toBeChecked()
  await page.goto(`${origin}/?horoskoop=invalid#horoskoop`)
  await expect(section.getByRole('radio', { name: 'Vähk', exact: true })).toBeChecked()
})

test('cancelling native sharing leaves the clipboard alone and failed sharing can be retried', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-07T10:00:00Z') })
  await page.route('**/data/daily-horoscope.json', (route) => route.fulfill({ json: { date: '2026-09-07', entries } }))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {
      throw new DOMException('Cancelled', 'AbortError')
    } })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {
      sessionStorage.setItem('clipboard-attempted', 'true')
      throw new DOMException('Denied', 'NotAllowedError')
    } } })
  })
  await page.goto('http://kaubamaja.localhost:4173/')
  const section = page.getByRole('region', { name: 'Horoskoop', exact: true })
  await section.getByRole('button', { name: 'Jaga', exact: true }).click()
  await expect(section.getByRole('button', { name: 'Jaga', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => sessionStorage.getItem('clipboard-attempted'))).toBeNull()
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: async () => {
    throw new DOMException('Unavailable', 'NotAllowedError')
  } }))
  await section.getByRole('button', { name: 'Jaga', exact: true }).click()
  await expect(section.getByRole('button', { name: 'Proovi uuesti', exact: true })).toBeEnabled()
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => {
    sessionStorage.setItem('copied-horoscope', text)
  } } }))
  await section.getByRole('button', { name: 'Proovi uuesti', exact: true }).click()
  await expect(section.getByRole('button', { name: 'Link kopeeritud', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => sessionStorage.getItem('copied-horoscope'))).toBe('http://kaubamaja.localhost:4173/?horoskoop=aries#horoskoop')
})
