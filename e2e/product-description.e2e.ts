import { expect, test, type Page, type Route } from '@playwright/test'

const storeId = '10000000-0000-4000-8000-000000000091'
const imageUrl = `http://localhost:4174/storage/v1/object/public/product-images/${storeId}/image/medium.webp`
const initialDescription = 'Kõrgus 25 cm.'
const generatedDescription = 'Heleda mati pinnaga vaas on ümara kuju ja kitsa kaelaga. Vaasi kõrgus on 25 cm.'

async function openEditor(page: Page, generate: (route: Route) => Promise<void>) {
  const product = { id: 'description-product', store_id: storeId, name: 'Savivaas', description: initialDescription, image_url: imageUrl, gallery: [imageUrl], price: 25, search_visible: true }
  const saves: unknown[] = []
  await page.route('**/storage/v1/object/public/product-images/**', (route) => route.fulfill({ contentType: 'image/webp', path: 'public/images/poeruumi-kaubamaja-hero2.webp' }))
  await page.route('**/__e2e_supabase/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/storage/v1/object/')) {
      await route.fulfill({ contentType: 'image/webp', path: 'public/images/poeruumi-kaubamaja-hero2.webp' })
    } else if (url.pathname.endsWith('/functions/v1/product-description')) {
      await generate(route)
    } else if (url.pathname.endsWith('/rest/v1/products')) {
      if (route.request().method() === 'POST') {
        const updated = route.request().postDataJSON()
        saves.push(updated)
        await route.fulfill({ json: updated })
      } else await route.fulfill({ json: [product] })
    } else if (url.pathname.endsWith('/rest/v1/platform_settings') || url.pathname.includes('/rpc/')) {
      await route.fulfill({ json: null })
    } else await route.fulfill({ json: [] })
  })
  await page.goto('http://localhost:4174/')
  await expect(page.getByRole('heading', { name: /Sinu e-pood/ })).toBeVisible()
  await page.evaluate(async () => {
    const { mountProductDescriptionHarness } = await import('/e2e/product-description-harness.tsx')
    mountProductDescriptionHarness()
  })
  await page.getByRole('button', { name: 'Muuda toodet' }).click()
  await expect(page.getByRole('textbox', { name: 'Toote kirjeldus' })).toHaveText(initialDescription)
  return saves
}

test('generates an editable draft, restores the previous text and saves only on request', async ({ page }) => {
  let body: Record<string, unknown> | null = null
  const saves = await openEditor(page, async (route) => {
    body = route.request().postDataJSON()
    await route.fulfill({ json: { description: generatedDescription } })
  })
  const description = page.getByRole('textbox', { name: 'Toote kirjeldus' })
  await page.getByRole('button', { name: 'Genereeri kirjeldus', exact: true }).click()
  await expect(description).toHaveText(generatedDescription)
  expect(body).toEqual({ storeId, imageUrl, name: 'Savivaas', description: initialDescription })
  expect(saves).toHaveLength(0)
  await page.getByRole('button', { name: 'Taasta eelmine' }).click()
  await expect(description).toHaveText(initialDescription)
  await page.getByRole('button', { name: 'Genereeri kirjeldus', exact: true }).click()
  await expect(description).toHaveText(generatedDescription)
  const edited = `${generatedDescription} Saadaval üks eksemplar.`
  await description.fill(edited)
  await page.getByRole('button', { name: 'Salvesta muudatused' }).click()
  await expect.poll(() => saves.length).toBe(1)
  expect(saves[0]).toMatchObject({ description: edited })
  await expect(page.getByRole('button', { name: 'Genereeri kirjeldus', exact: true })).toHaveCount(0)
})

test('preserves typing during generation and fits the compact mobile heading', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await openEditor(page, async (route) => { await gate; await route.fulfill({ json: { description: generatedDescription } }) })
  await page.getByRole('button', { name: 'Genereeri kirjeldus', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Genereerin…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Salvesta muudatused' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Salvesta ja avalda' })).toBeDisabled()
  const description = page.getByRole('textbox', { name: 'Toote kirjeldus' })
  await description.fill('Minu enda uus kirjeldus.')
  release()
  await expect(page.getByRole('button', { name: 'Genereeri kirjeldus', exact: true })).toBeEnabled()
  await expect(description).toHaveText('Minu enda uus kirjeldus.')
  await expect(page.getByRole('button', { name: 'Taasta eelmine' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('keeps the description after an API error and ignores results after cancelling editing', async ({ page }) => {
  await openEditor(page, (route) => route.fulfill({ status: 429, json: { error: 'Liiga palju päringuid. Palun proovi veidi hiljem uuesti.' } }))
  await page.getByRole('button', { name: 'Genereeri kirjeldus', exact: true }).click()
  await expect(page.getByText('Liiga palju päringuid. Palun proovi veidi hiljem uuesti.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Toote kirjeldus' })).toHaveText(initialDescription)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/functions/v1/product-description', async (route) => { await gate; await route.fulfill({ json: { description: generatedDescription } }).catch(() => undefined) })
  await page.getByRole('button', { name: 'Genereeri kirjeldus', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Genereerin…' })).toBeDisabled()
  await page.getByRole('button', { name: 'Loobu muudatustest' }).click()
  release()
  await page.getByRole('button', { name: 'Muuda toodet' }).click()
  await expect(page.getByRole('textbox', { name: 'Toote kirjeldus' })).toHaveText(initialDescription)
})
