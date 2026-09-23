import { expect, test, type Page } from '@playwright/test'

type FaqTrackingWindow = Window & {
  homepageEvents: { name: string; label: string }[]
}

async function observeHomepageEvents(page: Page) {
  await page.addInitScript(() => {
    const state = window as FaqTrackingWindow
    state.homepageEvents = []
  })
  // Observe the analytics boundary locally while exercising real browser
  // activation and toggle events in the actual homepage.
  await page.route('**/src/lib/homepageAnalytics.ts', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export * from '/src/lib/homepageAnalytics.ts?original';
      export const trackHomepageEvent = (name, label) => {
        window.homepageEvents.push({ name, label });
      };
    `,
  }))
  await page.goto('/')
  await expect(page.locator('details[data-analytics-label="pricing"]')).toBeVisible()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  return () => page.evaluate(() => (window as FaqTrackingWindow).homepageEvents.filter((event) => event.name === 'faq_open'))
}

test('FAQ analytics ignores default-open pricing, programmatic toggles, and answer clicks', async ({ page }) => {
  const events = await observeHomepageEvents(page)
  const pricing = page.locator('details[data-analytics-label="pricing"]')
  await expect(pricing).toHaveJSProperty('open', true)
  expect(await events()).toEqual([])

  await pricing.locator('p').click()
  await pricing.locator('summary').click()
  await expect(pricing).toHaveJSProperty('open', false)
  expect(await events()).toEqual([])

  const requirements = page.locator('details[data-analytics-label="requirements"]')
  await requirements.evaluate((details: HTMLDetailsElement) => new Promise<void>((resolve) => {
    details.addEventListener('toggle', () => resolve(), { once: true })
    details.open = true
  }))
  await requirements.evaluate((details: HTMLDetailsElement) => new Promise<void>((resolve) => {
    details.addEventListener('toggle', () => resolve(), { once: true })
    details.open = false
  }))
  await requirements.locator('summary').evaluate((summary: HTMLElement) => summary.click())
  await expect(requirements).toHaveJSProperty('open', true)
  expect(await events()).toEqual([])
})

test('FAQ analytics counts mouse and keyboard openings, including reopening pricing', async ({ page }) => {
  const events = await observeHomepageEvents(page)
  const pricing = page.locator('details[data-analytics-label="pricing"]')
  await pricing.locator('summary').click()
  await pricing.locator('summary span').click()
  await expect(pricing).toHaveJSProperty('open', true)
  expect(await events()).toEqual([{ name: 'faq_open', label: 'pricing' }])

  const requirements = page.locator('details[data-analytics-label="requirements"]')
  await requirements.locator('summary').press('Enter')
  await expect(requirements).toHaveJSProperty('open', true)
  await requirements.locator('summary').press('Enter')
  await expect(requirements).toHaveJSProperty('open', false)
  expect(await events()).toEqual([
    { name: 'faq_open', label: 'pricing' },
    { name: 'faq_open', label: 'requirements' },
  ])

  await page.getByRole('button', { name: /Vaata veel 7 küsimust/ }).click()
  const buyerAccount = page.locator('details[data-analytics-label="buyer_account"]')
  await buyerAccount.locator('summary').press('Space')
  await expect(buyerAccount).toHaveJSProperty('open', true)
  expect(await events()).toEqual([
    { name: 'faq_open', label: 'pricing' },
    { name: 'faq_open', label: 'requirements' },
    { name: 'faq_open', label: 'buyer_account' },
  ])
})
