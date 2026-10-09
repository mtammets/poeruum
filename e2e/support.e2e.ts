import { expect, test, type Page } from '@playwright/test'
import { Buffer } from 'node:buffer'

const user = { id: '20000000-0000-4000-8000-000000000009', email: 'support-test@example.invalid', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01T12:00:00Z' }
const date = '2026-10-08T12:00:00Z'

async function setup(page: Page, options: { empty?: boolean; failList?: boolean; longThread?: boolean; store?: 'full' | 'empty' | 'public' } = {}) {
  const conversations = options.empty ? [] : [
    { id: 'payments', subject: 'Maksete ühendamine', category: 'payments', status: 'waiting_user', last_message_at: date, last_message_preview: 'Kas saad nüüd uuesti proovida?', user_read_at: null },
    { id: 'setup', subject: 'Poe seadistamine', category: 'setup', status: 'resolved', last_message_at: '2026-10-06T12:00:00Z', last_message_preview: 'Kõik töötab, aitäh!', user_read_at: date },
  ]
  const message = (id: string, sender: string, body: string) => ({ id, sender_kind: sender, body, attachment_path: null, attachment_name: null, delivery_status: null, created_at: date })
  const messages: Record<string, ReturnType<typeof message>[]> = {
    payments: options.longThread
      ? Array.from({ length: 24 }, (_, index) => message(`message-${index}`, index % 2 ? 'admin' : 'user', `Sõnum ${index + 1}. Maksete ühendamine ei õnnestu. Proovisin uuesti.`))
      : [message('one', 'user', 'Maksete ühendamine ei õnnestu.'), message('two', 'admin', 'Kas saad nüüd uuesti proovida?')],
    setup: [message('three', 'user', 'Kõik töötab, aitäh!')],
  }
  const calls: Record<string, any>[] = []
  const uploads: string[] = []
  let failSend = false
  await page.addInitScript((testUser) => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: testUser.id, exp: expires }))}.test`
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at: expires, expires_in: 3600, token_type: 'bearer', user: testUser }))
  }, user)
  await page.route('**/storage/v1/object/public/product-images/**', (route) => route.fulfill({ path: 'public/images/kaubamaja-example-ceramics.webp', contentType: 'image/webp' }))
  await page.route('**/__e2e_supabase/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' } })
    if (path.endsWith('/auth/v1/user')) return json(user)
    if (path.endsWith('/products')) return json(options.store === 'empty' ? [] : [{ id: 'cup', name: 'Käsitöökruus', image_url: 'http://localhost:4174/storage/v1/object/public/product-images/test/cup.webp', price: 25, stock: 20, gallery: [], options: [] }])
    if (path.endsWith('/stores')) return json({ id: '10000000-0000-4000-8000-000000000071', settings: { editableStoreName: 'Mavi Stuudio' } })
    if (path.endsWith('/support_conversations')) {
      if (options.failList) return json({ message: 'Unavailable' }, 500)
      const id = url.searchParams.get('id')?.replace('eq.', '')
      return json(id ? conversations.find((item) => item.id === id) : conversations)
    }
    if (path.endsWith('/support_messages')) return json(messages[url.searchParams.get('conversation_id')!.replace('eq.', '')] ?? [])
    if (path.endsWith('/rpc/mark_support_conversation_read')) {
      const conversation = conversations.find((item) => item.id === route.request().postDataJSON().target_conversation_id)
      if (conversation) conversation.user_read_at = date
      return json(null)
    }
    if (path.includes('/storage/v1/object/support-attachments/')) {
      uploads.push(path)
      return json({ Key: path })
    }
    if (path.endsWith('/functions/v1/support-actions')) {
      const body = route.request().postDataJSON()
      calls.push(body)
      if (failSend) return json({ error: 'Sõnumit ei õnnestunud saata.' })
      if (body.action === 'create') {
        conversations.unshift({ id: 'created', subject: body.subject, category: body.category, status: 'open', last_message_at: date, last_message_preview: body.body, user_read_at: date })
        messages.created = [{ ...message('created-message', 'user', body.body), attachment_path: body.attachment_path, attachment_name: body.attachment_name }]
        return json({ id: 'created' })
      }
      messages[body.conversation_id].push(message('reply', 'user', body.body))
      return json({ ok: true })
    }
    return json([])
  })
  await page.routeWebSocket(/__e2e_supabase/, () => {})
  await page.goto(`http://poeruum.localhost:4174/e2e/support.html${options.store ? `?store=${options.store}` : ''}`)
  if (!options.store) {
    await page.getByRole('button', { name: 'Ava Poeruumi klienditugi' }).click()
    await expect(page.getByRole('button', { name: 'Kirjuta meile' })).toBeVisible()
  }
  await page.evaluate(() => document.fonts.ready)
  return { calls, uploads, failSend: (value: boolean) => { failSend = value } }
}

test('one message creates a conversation, preserves failed drafts and sends attachments', async ({ page }) => {
  const api = await setup(page, { empty: true })
  await page.getByRole('button', { name: 'Kirjuta meile' }).click()
  await expect(page.getByRole('button', { name: 'Saada', exact: true })).toBeDisabled()
  await page.getByLabel('Teema', { exact: true }).selectOption('payments')
  const body = 'Maksete ühendamine ei õnnestu.\nProovisin uuesti, aga maksete seadistamise vaade jääb pärast andmete sisestamist laadima.'
  await page.getByRole('textbox', { name: 'Sõnum' }).fill(body)
  await page.locator('input[type=file]').setInputFiles({ name: 'ekraanipilt.png', mimeType: 'image/png', buffer: Buffer.from('test-image') })
  await page.getByRole('button', { name: 'Eemalda manus' }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'ekraanipilt.png', mimeType: 'image/png', buffer: Buffer.from('test-image') })
  api.failSend(true)
  await page.getByRole('button', { name: 'Saada', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Sõnumit ei õnnestunud saata.')
  await expect(page.getByRole('textbox', { name: 'Sõnum' })).toHaveValue(body)
  await expect(page.getByText('ekraanipilt.png', { exact: true })).toBeVisible()
  api.failSend(false)
  await page.getByRole('button', { name: 'Saada', exact: true }).click()
  await expect(page.getByRole('log')).toContainText(body)
  expect(api.calls.at(-1)).toMatchObject({ action: 'create', category: 'payments', body, attachment_name: 'ekraanipilt.png' })
  expect(api.calls.at(-1)!.subject.length).toBeLessThanOrEqual(80)
  expect(api.calls.at(-1)!.subject).not.toContain('\n')
  expect(api.uploads.length).toBe(2)
  await page.getByRole('textbox', { name: 'Vastus' }).fill('Nüüd töötab.')
  await page.getByRole('button', { name: 'Saada vastus' }).click()
  await expect(page.getByRole('log')).toContainText('Nüüd töötab.')
  expect(api.calls.at(-1)).toMatchObject({ action: 'user_reply', conversation_id: 'created', body: 'Nüüd töötab.' })
})

test('history, resolved state and keyboard navigation stay usable', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: /Maksete ühendamine/ }).click()
  await expect(page.getByRole('log')).toContainText('Kas saad nüüd uuesti proovida?')
  await page.getByRole('button', { name: 'Tagasi vestluste juurde' }).click()
  await expect(page.locator('.support-history .is-unread')).toHaveCount(0)
  await page.getByRole('button', { name: /Poe seadistamine/ }).click()
  await expect(page.getByText('Lahendatud', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Vastus' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Uus vestlus', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Sõnum' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Ava Poeruumi klienditugi' })).toBeFocused()
})

test('load errors and oversized attachments remain visible', async ({ page }) => {
  await setup(page, { failList: true })
  await expect(page.getByRole('alert')).toHaveText('Vestlusi ei õnnestunud laadida.')
  await page.getByRole('button', { name: 'Kirjuta meile' }).click()
  await page.getByRole('textbox', { name: 'Sõnum' }).fill('Palun abi.')
  await page.locator('input[type=file]').setInputFiles({ name: 'suur.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
  await expect(page.getByRole('alert')).toContainText('5 MB')
  await expect(page.getByRole('textbox', { name: 'Sõnum' })).toHaveValue('Palun abi.')
})

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 640 }, { width: 844, height: 390 }]) {
  test(`support fits ${viewport.width}×${viewport.height} with reachable controls`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await setup(page, { longThread: true })
    const dialog = page.getByRole('dialog')
    const assertFits = async () => {
      const bounds = await dialog.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1)
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      await expect(page.getByRole('button', { name: 'Sulge tugi' })).toBeInViewport()
    }
    await assertFits()
    await page.mouse.move(0, 0)
    await dialog.screenshot({ path: `output/support-home-${viewport.width}.png`, animations: 'disabled' })
    await page.getByRole('button', { name: 'Kirjuta meile' }).click()
    await assertFits()
    await page.getByRole('button', { name: 'Saada', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'Saada', exact: true })).toBeInViewport()
    await dialog.screenshot({ path: `output/support-compose-${viewport.width}.png`, animations: 'disabled' })
    await page.getByRole('button', { name: 'Tagasi vestluste juurde' }).click()
    await page.getByRole('button', { name: /Maksete ühendamine/ }).click()
    await expect(page.getByRole('log')).toContainText('Sõnum 24.')
    await assertFits()
    await expect(page.getByRole('textbox', { name: 'Vastus' })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Saada vastus' })).toBeInViewport()
    expect(await page.getByRole('log').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await dialog.screenshot({ path: `output/support-thread-${viewport.width}.png`, animations: 'disabled' })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(dialog).toHaveCSS('animation-name', 'none')
    const closeBounds = await page.getByRole('button', { name: 'Sulge tugi' }).boundingBox()
    expect(closeBounds!.width).toBeGreaterThanOrEqual(44)
  })
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 540 }]) {
  test(`merchant support opens from the toolbar at ${viewport.width}px and hides in customer preview`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await setup(page, { store: 'full' })
    const help = page.getByRole('button', { name: 'Abi ja tugi', exact: true })
    await expect(help).toBeInViewport()
    const toolbar = await page.locator('.admin-global-actions').boundingBox()
    expect(toolbar!.x).toBeGreaterThanOrEqual(0)
    expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(viewport.width)
    await page.screenshot({ path: `output/support-toolbar-${viewport.width}.png`, animations: 'disabled' })
    await help.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Sulge tugi' }).click()
    await expect(help).toBeFocused()
    await page.getByRole('button', { name: 'Vaata poodi kliendina' }).click()
    await expect(help).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ava Poeruumi klienditugi' })).toBeHidden()
  })
}

test('support is discoverable before the first product', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page, { store: 'empty' })
  await expect(page.getByRole('heading', { name: 'Lisa esimene toode' })).toBeVisible()
  await page.getByRole('button', { name: 'Abi ja tugi', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
