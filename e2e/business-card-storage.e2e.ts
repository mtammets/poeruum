import { expect, test } from '@playwright/test'

test('browser card drafts keep embedded images across reload and isolate each administrator', async ({ page }) => {
  await page.goto('/admin/business-card')
  const imageLength = await page.evaluate(async () => {
    const { createDefaultCard, createCardElement } = await import('/src/businessCard/model.ts')
    const { saveLocalCardDraft } = await import('/src/businessCard/storage.ts')
    const document = createDefaultCard()
    // A real PNG large enough to exercise binary image persistence, including alpha.
    const canvas = window.document.createElement('canvas')
    canvas.width = 600
    canvas.height = 600
    const context = canvas.getContext('2d')!
    const pixels = context.createImageData(canvas.width, canvas.height)
    for (let index = 0; index < pixels.data.length; index += 1) pixels.data[index] = (index * 137 + Math.floor(index / 503)) % 256
    context.putImageData(pixels, 0, 0)
    const src = canvas.toDataURL('image/png')
    document.sides.front.elements.push(createCardElement('image', { src, pixelWidth: 600, pixelHeight: 600 }))
    await saveLocalCardDraft('admin-one', { document, baseRevision: 7, dirty: true, updatedAt: '2026-09-05T12:00:00Z' })
    await saveLocalCardDraft('admin-two', { document: createDefaultCard(), baseRevision: 2, dirty: false, updatedAt: '2026-09-05T11:00:00Z' })
    return src.length
  })
  await page.reload()
  const recovered = await page.evaluate(async () => {
    const { loadLocalCardDraft, removeLocalCardDraft } = await import('/src/businessCard/storage.ts')
    const first = await loadLocalCardDraft('admin-one')
    const second = await loadLocalCardDraft('admin-two')
    const missing = await loadLocalCardDraft('unrelated-admin')
    await removeLocalCardDraft('admin-two')
    return {
      imageLength: first?.document.sides.front.elements.at(-1)?.src?.length,
      baseRevision: first?.baseRevision,
      dirty: first?.dirty,
      secondHasImage: second?.document.sides.front.elements.some((element) => element.type === 'image'),
      secondRevision: second?.baseRevision,
      missing,
      removed: await loadLocalCardDraft('admin-two'),
      retained: (await loadLocalCardDraft('admin-one'))?.baseRevision,
    }
  })
  expect(imageLength).toBeGreaterThan(10000)
  expect(recovered).toEqual({ imageLength, baseRevision: 7, dirty: true, secondHasImage: false, secondRevision: 2, missing: null, removed: null, retained: 7 })
})

test('unavailable browser storage is surfaced instead of reporting a saved draft', async ({ page }) => {
  await page.goto('/admin/business-card')
  const results = await page.evaluate(async () => {
    const { createDefaultCard } = await import('/src/businessCard/model.ts')
    const { loadLocalCardDraft, saveLocalCardDraft } = await import('/src/businessCard/storage.ts')
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
    const load = await loadLocalCardDraft('admin-one').then(() => 'accepted', (error: Error) => error.message)
    const save = await saveLocalCardDraft('admin-one', {
      document: createDefaultCard(), baseRevision: null, dirty: true, updatedAt: '2026-09-05T12:00:00Z',
    }).then(() => 'accepted', (error: Error) => error.message)
    return { load, save }
  })
  expect(results.load).toContain('ei ole saadaval')
  expect(results.save).toContain('ei ole saadaval')
})
