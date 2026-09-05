import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

async function mountEditor(page: Page) {
  await page.goto('/admin/business-card')
  await page.evaluate(async () => {
    const { mountBusinessCardHarness } = await import('/e2e/business-card-harness.tsx')
    await mountBusinessCardHarness()
  })
  await expect(page.locator('.business-card-editor')).toBeVisible()
}

test('the business card route remains behind the admin access check', async ({ page }) => {
  await page.goto('/admin/business-card')
  await expect(page).toHaveURL(/\/admin\/business-card$/)
  await expect(page.getByRole('heading', { name: 'Supabase pole ühendatud' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ekspordi PDF' })).toHaveCount(0)
})

test('both editable sides are restored from the browser draft after a page reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mountEditor(page)

  await page.getByRole('button', { name: 'Lisa tekst', exact: true }).click()
  await page.getByRole('textbox', { name: 'Tekst', exact: true }).fill('Õie Käsitöö')
  await page.getByLabel('X (mm)', { exact: true }).fill('14')
  await page.getByLabel('Y (mm)', { exact: true }).fill('20')
  await page.getByLabel('Laius (mm)', { exact: true }).fill('50')
  await expect(page.getByRole('group', { name: 'Esikülje kujundus' })).toContainText('Õie Käsitöö')

  await page.getByRole('tab', { name: 'Tagakülg', exact: true }).click()
  await page.getByRole('button', { name: 'Lisa tekst', exact: true }).click()
  await page.getByRole('textbox', { name: 'Tekst', exact: true }).fill('tere@example.ee')
  await expect(page.getByRole('group', { name: 'Tagakülje kujundus' })).toContainText('tere@example.ee')
  await expect(page.getByRole('group', { name: 'Tagakülje kujundus' })).not.toContainText('Õie Käsitöö')

  await page.evaluate(() => window.__businessCardSaved)
  await mountEditor(page)
  await expect(page.getByRole('group', { name: 'Esikülje kujundus' })).toContainText('Õie Käsitöö')
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1))).toMatchObject({
    text: 'Õie Käsitöö', x: 14, y: 20, width: 50,
  })
  await page.getByRole('tab', { name: 'Tagakülg', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Tagakülje kujundus' })).toContainText('tere@example.ee')
  expect(errors).toEqual([])
})

test('element geometry changes can be undone and redone without affecting the opposite side', async ({ page }) => {
  await mountEditor(page)
  const backBefore = await page.evaluate(() => window.__businessCardDocument?.sides.back)
  await page.getByRole('button', { name: 'Lisa kujund', exact: true }).click()
  await page.getByLabel('X (mm)', { exact: true }).fill('15')
  await page.getByLabel('Pööre (°)', { exact: true }).fill('45')
  await page.getByLabel('Pööre (°)', { exact: true }).blur()
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1)?.rotation)).toBe(45)

  await page.getByRole('button', { name: 'Võta tagasi', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1)?.rotation)).toBe(0)
  await page.getByRole('button', { name: 'Tee uuesti', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1)?.rotation)).toBe(45)
  expect(await page.evaluate(() => window.__businessCardDocument?.sides.back)).toEqual(backBefore)
})

test('dragging a canvas object updates its millimeter position and creates one undo step', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mountEditor(page)
  await page.getByRole('button', { name: 'Lisa kujund', exact: true }).click()
  const initial = await page.evaluate(() => window.__businessCardDocument!.sides.front.elements.at(-1)!)
  const element = page.locator(`[data-element-id="${initial.id}"]`).first()
  const bounds = await element.boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 37, bounds!.y + bounds!.height / 2 + 23, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1)?.x)).toBeGreaterThan(initial.x)
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1)?.y)).toBeGreaterThan(initial.y)
  await page.getByRole('button', { name: 'Võta tagasi', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1))).toMatchObject({
    x: initial.x, y: initial.y, width: initial.width, height: initial.height,
  })
})

test('a corner handle resizes an object and undo restores its original dimensions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mountEditor(page)
  await page.getByRole('button', { name: 'Lisa kujund', exact: true }).click()
  const initial = await page.evaluate(() => window.__businessCardDocument!.sides.front.elements.at(-1)!)
  const handle = page.getByRole('button', { name: 'Muuda suurust: alumine parem', exact: true })
  const bounds = await handle.boundingBox()
  expect(bounds).not.toBeNull()
  const x = bounds!.x + bounds!.width / 2
  const y = bounds!.y + bounds!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 35, y + 25, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1)?.width)).toBeGreaterThan(initial.width)
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1)?.height)).toBeGreaterThan(initial.height)
  await page.getByRole('button', { name: 'Võta tagasi', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1))).toMatchObject({
    x: initial.x, y: initial.y, width: initial.width, height: initial.height,
  })
})

test('a text copy preserves formatting, offsets its position, and supports locking and deletion', async ({ page }) => {
  await mountEditor(page)
  await page.getByRole('button', { name: 'Lisa tekst', exact: true }).click()
  await page.getByRole('textbox', { name: 'Tekst', exact: true }).fill('Väike pood')
  await page.getByLabel('X (mm)', { exact: true }).fill('12')
  await page.getByLabel('Y (mm)', { exact: true }).fill('18')
  await page.getByLabel('Värv: HEX', { exact: true }).fill('#E4EF85')
  await page.getByRole('combobox', { name: 'Kirjatüüp', exact: true }).selectOption('serif')
  await page.getByRole('button', { name: 'Tee koopia', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1))).toMatchObject({
    text: 'Väike pood', x: 14, y: 20, color: '#E4EF85', fontFamily: 'serif',
  })
  await page.getByRole('button', { name: 'Lukusta element', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Kustuta element', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Tekst', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Ava element', exact: true }).click()
  await page.getByRole('button', { name: 'Kustuta element', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.length)).toBe(4)
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1)?.text)).toBe('Väike pood')
})

test('double-clicking text opens direct canvas editing', async ({ page }) => {
  await mountEditor(page)
  const element = page.getByRole('group', { name: 'Esikülje kujundus' }).getByRole('button', { name: 'Poeruum', exact: true })
  await element.dblclick()
  const inline = page.getByRole('textbox', { name: 'Muuda teksti kaardil', exact: true })
  await expect(inline).toBeFocused()
  await inline.fill('Käsitöö')
  await inline.press('Escape')
  await expect(inline).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Esikülje kujundus' })).toContainText('Käsitöö')
})

test('uploaded images remain embedded and preflight links back to their print-quality problem', async ({ page }) => {
  await mountEditor(page)
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 600; canvas.height = 300
    const context = canvas.getContext('2d')!
    context.fillStyle = '#d9884d'; context.fillRect(0, 0, 300, 300)
    context.fillStyle = '#286f54'; context.fillRect(300, 0, 300, 300)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Lisa pilt', exact: true }).click()
  await (await chooserPromise).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') })
  await expect(page.getByText('600 × 300 px', { exact: true })).toBeVisible()
  await page.getByLabel('Laius (mm)', { exact: true }).fill('70')
  await page.getByLabel('Pildi asukoht: horisontaalne', { exact: true }).fill('25')
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.front.elements.at(-1))).toMatchObject({
    type: 'image', pixelWidth: 600, pixelHeight: 300, cropX: 25, src: expect.stringMatching(/^data:image\/png;base64,/),
  })
  await page.getByRole('button', { name: 'Ekspordi PDF', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Trüki-PDF', exact: true })
  await expect(dialog.getByRole('button', { name: 'Laadi PDF alla', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: /Pildi kvaliteet on trükiks madal/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByLabel('Laius (mm)', { exact: true })).toHaveValue('70')
})

test('QR content and square print dimensions can be edited independently on the back', async ({ page }) => {
  await mountEditor(page)
  await page.getByRole('tab', { name: 'Tagakülg', exact: true }).click()
  await page.getByRole('button', { name: 'Lisa QR-kood', exact: true }).click()
  await page.getByRole('textbox', { name: 'QR-koodi sisu', exact: true }).fill('https://example.ee/pood')
  await page.getByLabel('Laius (mm)', { exact: true }).fill('20')
  await expect(page.getByLabel('Kõrgus (mm)', { exact: true })).toHaveValue('20')
  await expect.poll(() => page.evaluate(() => window.__businessCardDocument?.sides.back.elements.at(-1))).toMatchObject({
    type: 'qr', qrValue: 'https://example.ee/pood', width: 20, height: 20,
  })
  await page.getByRole('tab', { name: 'Esikülg', exact: true }).click()
  expect(await page.evaluate(() => window.__businessCardDocument?.sides.front.elements.some((element) => element.type === 'qr'))).toBe(false)
})

test('PDF export downloads both sides with physical trim and bleed dimensions', async ({ page }) => {
  await mountEditor(page)
  await page.getByRole('button', { name: 'Ekspordi PDF', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Laadi PDF alla', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.pdf$/)
  const path = await download.path()
  expect(path).not.toBeNull()
  const pdf = await PDFDocument.load(await readFile(path!))
  expect(pdf.getPageCount()).toBe(2)
  for (const side of pdf.getPages()) {
    const trim = side.getTrimBox()
    const bleed = side.getBleedBox()
    expect(trim.width * 25.4 / 72).toBeCloseTo(85, 2)
    expect(trim.height * 25.4 / 72).toBeCloseTo(55, 2)
    expect(bleed.width * 25.4 / 72).toBeCloseTo(91, 2)
    expect(bleed.height * 25.4 / 72).toBeCloseTo(61, 2)
  }
})

for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`editor tools and canvas fit the admin shell at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await mountEditor(page)
    await expect(page.getByRole('button', { name: 'Lisa tekst', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Esikülje kujundus' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ekspordi PDF', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
    for (const thumbnail of await page.locator('.bc-side-previews > button > svg').all()) {
      const bounds = await thumbnail.boundingBox()
      expect(bounds!.width).toBeGreaterThanOrEqual(80)
      expect(bounds!.height / bounds!.width).toBeCloseTo(55 / 85, 2)
    }
    await page.screenshot({ path: testInfo.outputPath(`editor-${viewport.width}.png`), fullPage: true })
  })
}
