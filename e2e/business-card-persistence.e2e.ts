import { expect, test, type Page, type Route } from '@playwright/test'
import { createDefaultCard, type CardDocument } from '../src/businessCard/model'
import type { LocalCardDraft } from '../src/businessCard/storage'

test.use({ baseURL: 'http://localhost:4174' })

const USER_ID = '85000000-0000-4000-8000-000000000001'
const timestamp = '2026-09-05T12:00:00Z'
const makeCard = (name: string) => {
  const document = createDefaultCard()
  const title = document.sides.front.elements.find((element) => element.name === 'Poeruum')!
  title.text = name
  title.fontSize = 12
  return document
}
const respond = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
const cloudRow = (document: CardDocument, revision: number) => ({ document, revision, updated_at: timestamp })

async function mount(page: Page, draft?: LocalCardDraft) {
  await page.goto('/admin/business-card')
  if (draft) await page.evaluate(async ({ userId, value }) => {
    const { saveLocalCardDraft } = await import('/src/businessCard/storage.ts')
    await saveLocalCardDraft(userId, value)
  }, { userId: USER_ID, value: draft })
  await page.evaluate(async (userId) => {
    const { mountBusinessCardPersistenceHarness } = await import('/e2e/business-card-persistence-harness.tsx')
    mountBusinessCardPersistenceHarness(userId)
  }, USER_ID)
  await expect(page.locator('.business-card-editor:not(.bc-loading)')).toBeVisible()
}

async function readLocal(page: Page) {
  return page.evaluate(async (userId) => {
    const { loadLocalCardDraft } = await import('/src/businessCard/storage.ts')
    return loadLocalCardDraft(userId)
  }, USER_ID)
}

async function addText(page: Page, value: string) {
  await page.getByRole('button', { name: 'Lisa tekst', exact: true }).click()
  await page.getByRole('textbox', { name: 'Tekst', exact: true }).fill(value)
}

test('cloud unavailability restores the local draft and never creates over an unknown cloud version', async ({ page }) => {
  let saves = 0
  await page.route('**/__e2e_supabase/rest/v1/admin_business_card_drafts?*', (route) => respond(route, { message: 'unavailable' }, 503))
  await page.route('**/__e2e_supabase/rest/v1/rpc/admin_save_business_card', (route) => { saves += 1; return respond(route, { message: 'unexpected save' }, 500) })
  await mount(page, { document: makeCard('Kohalik kujundus'), baseRevision: 4, dirty: true, updatedAt: timestamp })
  await expect(page.getByRole('group', { name: 'Esikülje kujundus' })).toContainText('Kohalik kujundus')
  await addText(page, 'Võrguta lisatud')
  await expect.poll(async () => (await readLocal(page))?.document.sides.front.elements.at(-1)?.text).toBe('Võrguta lisatud')
  await page.waitForTimeout(1200)
  expect(saves).toBe(0)
  await mount(page)
  await expect(page.getByRole('group', { name: 'Esikülje kujundus' })).toContainText('Võrguta lisatud')
  expect((await readLocal(page))?.baseRevision).toBe(4)
  expect(saves).toBe(0)
})

test('a restored stale draft stays blocked on reconnect until the administrator chooses a version', async ({ page }) => {
  const remote = makeCard('Uuem pilveversioon')
  let saves = 0
  await page.route('**/__e2e_supabase/rest/v1/admin_business_card_drafts?*', (route) => respond(route, cloudRow(remote, 5)))
  await page.route('**/__e2e_supabase/rest/v1/rpc/admin_save_business_card', (route) => { saves += 1; return respond(route, { message: 'unexpected save' }, 500) })
  await mount(page, { document: makeCard('Minu muudatus'), baseRevision: 4, dirty: true, updatedAt: timestamp })
  await expect(page.getByRole('button', { name: 'Ava pilveversioon' })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(1200)
  await expect(page.getByRole('group', { name: 'Esikülje kujundus' })).toContainText('Minu muudatus')
  expect((await readLocal(page))?.baseRevision).toBe(4)
  expect(saves).toBe(0)
  await page.getByRole('button', { name: 'Ava pilveversioon' }).click()
  await expect(page.getByRole('group', { name: 'Esikülje kujundus' })).toContainText('Uuem pilveversioon')
  await expect.poll(async () => ({ revision: (await readLocal(page))?.baseRevision, dirty: (await readLocal(page))?.dirty })).toEqual({ revision: 5, dirty: false })
  expect(saves).toBe(0)
})

test('a stale in-session cloud save is never silently retried using the newer revision', async ({ page }) => {
  let remote = cloudRow(makeCard('Algne'), 1)
  const saves: Array<{ expected_revision: number | null; next_document: CardDocument }> = []
  await page.route('**/__e2e_supabase/rest/v1/admin_business_card_drafts?*', (route) => respond(route, remote))
  await page.route('**/__e2e_supabase/rest/v1/rpc/admin_save_business_card', async (route) => {
    const request = route.request().postDataJSON()
    saves.push(request)
    if (saves.length === 1) {
      remote = cloudRow(makeCard('Teise akna muudatus'), 2)
      return respond(route, { code: '40001', message: 'conflict' }, 409)
    }
    remote = cloudRow(request.next_document, 3)
    return respond(route, remote)
  })
  await mount(page)
  await addText(page, 'Minu uus tekst')
  await expect(page.getByRole('button', { name: 'Salvesta see versioon' })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(1200)
  expect(saves).toHaveLength(1)
  expect(saves[0].expected_revision).toBe(1)
  await page.getByRole('button', { name: 'Salvesta see versioon' }).click()
  await expect.poll(() => saves.length).toBe(2)
  expect(saves[1].expected_revision).toBe(2)
  expect(saves[1].next_document.sides.front.elements.at(-1)?.text).toBe('Minu uus tekst')
  await expect.poll(async () => (await readLocal(page))?.dirty).toBe(false)
})

test('edits made during a cloud save are saved next with the returned revision', async ({ page }) => {
  const saves: Array<{ expected_revision: number | null; next_document: CardDocument }> = []
  let releaseFirstSave: (() => void) | undefined
  await page.route('**/__e2e_supabase/rest/v1/admin_business_card_drafts?*', (route) => respond(route, cloudRow(makeCard('Algne'), 1)))
  await page.route('**/__e2e_supabase/rest/v1/rpc/admin_save_business_card', async (route) => {
    const request = route.request().postDataJSON()
    saves.push(request)
    const nextRevision = saves.length + 1
    if (saves.length === 1) await new Promise<void>((resolve) => { releaseFirstSave = resolve })
    return respond(route, cloudRow(request.next_document, nextRevision))
  })
  await mount(page)
  await addText(page, 'Esimene muudatus')
  await expect.poll(() => saves.length).toBe(1)
  await page.getByRole('textbox', { name: 'Tekst', exact: true }).fill('Salvestamise ajal muudetud')
  await expect.poll(async () => (await readLocal(page))?.document.sides.front.elements.at(-1)?.text).toBe('Salvestamise ajal muudetud')
  releaseFirstSave!()
  await expect.poll(() => saves.length).toBe(2)
  expect(saves[0].expected_revision).toBe(1)
  expect(saves[0].next_document.sides.front.elements.at(-1)?.text).toBe('Esimene muudatus')
  expect(saves[1].expected_revision).toBe(2)
  expect(saves[1].next_document.sides.front.elements.at(-1)?.text).toBe('Salvestamise ajal muudetud')
  await expect.poll(async () => ({ revision: (await readLocal(page))?.baseRevision, dirty: (await readLocal(page))?.dirty })).toEqual({ revision: 3, dirty: false })
})

test('refreshing a clean offline draft also refreshes its browser recovery copy', async ({ page }) => {
  let online = false
  const remote = makeCard('Värske pilvekaart')
  await page.route('**/__e2e_supabase/rest/v1/admin_business_card_drafts?*', (route) => online
    ? respond(route, cloudRow(remote, 5))
    : respond(route, { message: 'unavailable' }, 503))
  await mount(page, { document: makeCard('Eelmine koopia'), baseRevision: 4, dirty: false, updatedAt: timestamp })
  await expect(page.getByRole('group', { name: 'Esikülje kujundus' })).toContainText('Eelmine koopia')
  online = true
  await page.getByRole('button', { name: 'Proovi uuesti' }).click()
  await expect(page.getByRole('group', { name: 'Esikülje kujundus' })).toContainText('Värske pilvekaart')
  await expect.poll(async () => (await readLocal(page))?.baseRevision).toBe(5)
  online = false
  await mount(page)
  await expect(page.getByRole('group', { name: 'Esikülje kujundus' })).toContainText('Värske pilvekaart')
})
