import { expect, test } from '@playwright/test'

test('real app screens are available without signup and use isolated fixtures', async ({ page }) => {
  const externalWrites: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /supabase\.co|api\.stripe\.com/.test(request.url())) externalWrites.push(request.url())
  })
  await page.goto('/previews/payments.html')
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'Ühenda poe maksed' })).toBeVisible()
  await page.getByLabel('Maksete olukord').selectOption('reviewing')
  await expect(frame.getByText('Stripe kontrollib andmeid', { exact: true })).toBeVisible()
  await frame.getByRole('button', { name: /Jätka tarnega/ }).click()
  await expect(frame.getByRole('heading', { name: 'Vali tarneviisid' })).toBeVisible()
  await page.getByRole('button', { name: /Müüja andmed/ }).click()
  await expect(frame.getByRole('heading', { name: 'Sinu ettevõte' })).toBeVisible()
  await frame.getByLabel('Ettevõtte nimi', { exact: true }).fill('Muudetud näidis')
  await frame.getByRole('button', { name: /Jätka maksetega/ }).click()
  await page.getByRole('button', { name: /Alusta uuesti/ }).click()
  await expect(frame.getByLabel('Ettevõtte nimi', { exact: true })).toHaveValue('Näidise Käsitöö OÜ')
  await page.getByRole('button', { name: /Esimene toode/ }).click()
  await expect(frame.getByText('Esimene toode', { exact: true })).toBeVisible()
  expect(externalWrites).toEqual([])
})

test('publication waiting state reproduces the current app behavior', async ({ page }) => {
  await page.goto('/previews/payments.html')
  await page.getByLabel('Maksete olukord').selectOption('reviewing')
  await page.getByRole('button', { name: /Avaldamine/ }).click()
  const frame = page.frameLocator('iframe')
  await frame.getByRole('button', { name: /Kontrolli ja avalda pood/ }).click()
  await expect(frame.getByRole('alert')).toContainText('Stripe kontrollib veel esitatud andmeid')
  await page.getByLabel('Maksete olukord').selectOption('connected')
  await frame.getByRole('button', { name: 'Avalda pood', exact: false }).click()
  await expect(frame.getByRole('button', { name: 'Seaded', exact: true })).toBeVisible()
})

test('missing test credentials explain setup and never fall back to production', async ({ page, request }) => {
  await page.goto('/previews/payments.html')
  await page.getByRole('button', { name: 'Stripe’i vorm', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ühenda Stripe’i testkeskkond' })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  const config = await request.get('/__preview/config')
  expect(await config.json()).toEqual({ ready: false, publishableKey: '' })
  const rejected = await request.post('/__preview/sessions', { data: { kind: 'stripe' } })
  expect(rejected.status()).toBe(400)
})

test('phone preview uses an actual narrow viewport and fits a phone browser', async ({ page }) => {
  await page.goto('/previews/payments.html')
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'Ühenda poe maksed' })).toBeVisible()
  expect(await frame.locator('body').evaluate(() => window.innerWidth)).toBe(390)
  await page.getByRole('button', { name: 'Arvuti', exact: true }).click()
  expect(await frame.locator('body').evaluate(() => window.innerWidth)).toBeGreaterThan(800)
  await page.getByRole('button', { name: 'Telefon', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('cross-origin control calls and unknown operations are rejected', async ({ request }) => {
  const rejected = await request.post('/__preview/sessions', { headers: { Origin: 'https://example.com' }, data: {} })
  expect(rejected.status()).toBe(403)
  const unknown = await request.post('/__preview/delete-live-account', { data: { account: 'acct_external' } })
  expect(unknown.status()).toBe(404)
})
