import { expect, test, type Page } from '@playwright/test'

test.use({ baseURL: 'http://poeruum.localhost:4174' })
const date = '2026-10-09T15:34:00Z'
const longReply = 'Tere!\n\nJah, saad oma domeeni Poeruumi poega ühendada. Domeen jääb sinu praeguse teenusepakkuja juurde.\n\nÜhendamiseks:\n1. Ava poe halduses Seaded → Pood → Oma domeen.\n2. Sisesta domeen ja vajuta „Alusta ühendamist“.\n3. Muuda domeenihalduris DNS-kirje väärtus Poeruumis näidatud väärtuseks.\n4. Tule tagasi ja vajuta „Kontrolli ühendust“.\n\nKui mõni samm jääb segaseks, kirjuta siia — aitan hea meelega edasi!\n\nMarek\nPoeruum'

async function setup(page: Page, options: { long?: boolean; deepLink?: boolean } = {}) {
  const user = { id: 'admin-test', email: 'admin@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { role: 'admin' }, user_metadata: {}, created_at: date }
  const expires = Math.floor(Date.now() / 1000) + 3600
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: expires, app_metadata: user.app_metadata })).toString('base64url')}.test`
  const session = { access_token: token, refresh_token: 'test', expires_at: expires, expires_in: 3600, token_type: 'bearer', user }
  await page.addInitScript((value) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(value)), session)
  const conversations = [
    { id: 'mavi', user_id: 'merchant-1', email: 'tere@mavi.example', contact_name: null, origin: 'app', store_id: 'store-1', store_name: 'Mavi Stuudio', pricing_plan: 'flexible', subject: 'Oma domeeni ühendamine Poeruumiga', category: 'setup', status: 'open', last_message_at: date, last_message_preview: 'Mul on domeen olemas. Kuidas saan selle oma poega ühendada?', is_unread: true, created_at: date },
    { id: 'ceramics', user_id: 'merchant-2', email: 'tere@keraamika.example', contact_name: null, origin: 'app', store_id: 'store-2', store_name: 'Põhjala Keraamika', pricing_plan: 'fixed', subject: 'Kas poe seadistamisel on vaja abi?', category: 'question', status: 'waiting_user', last_message_at: date, last_message_preview: 'Esimene toode on lisatud. Aitan sul poe avada.', is_unread: false, created_at: date },
    { id: 'resolved', user_id: null, email: 'mari@example.invalid', contact_name: 'Mari', origin: 'email', store_id: null, store_name: null, pricing_plan: null, subject: 'Tootefoto lisamine', category: 'technical', status: 'resolved', last_message_at: date, last_message_preview: 'Kõik töötab, aitäh!', is_unread: false, created_at: date },
  ]
  const message = (id: string, body: string, sender = 'user', internal = false) => ({ id, body, sender_kind: sender, source: 'app', is_internal: internal, attachment_path: null, attachment_name: null, delivery_status: sender === 'admin' && !internal ? 'delivered' : null, created_at: date })
  const messages: Record<string, ReturnType<typeof message>[]> = {
    mavi: [message('first', 'Tere! Mul on domeen olemas. Kuidas saan selle oma Poeruumi poega ühendada?'), ...(options.long ? Array.from({ length: 12 }, (_, i) => message(`long-${i}`, i % 2 ? longReply : 'Aitäh! Kas domeeni ühendamiseks on vaja paketti muuta?', i % 2 ? 'admin' : 'user')) : [message('second', longReply, 'admin')])],
    ceramics: [message('third', 'Esimene toode on lisatud. Aitan sul poe avada.', 'admin')],
    resolved: [message('fourth', 'Kõik töötab, aitäh!')],
  }
  const actions: Record<string, any>[] = []
  let failSend = false
  let failList = false
  let holdMessages: string | null = null
  let releaseMessages: (() => Promise<void>) | undefined
  await page.route('**/__e2e_supabase/**', async (route) => {
    const url = new URL(route.request().url()), path = url.pathname
    if (path.endsWith('/auth/v1/user')) return route.fulfill({ json: user })
    if (path.endsWith('/auth/v1/token')) return route.fulfill({ json: session })
    if (path.endsWith('/rpc/admin_support_conversations')) return route.fulfill({ status: failList ? 503 : 200, json: failList ? { message: 'Unavailable' } : conversations })
    if (path.endsWith('/rpc/mark_support_conversation_read')) {
      const item = conversations.find((item) => item.id === route.request().postDataJSON().target_conversation_id)
      if (item) item.is_unread = false
      return route.fulfill({ json: null })
    }
    if (path.endsWith('/support_messages')) {
      const id = url.searchParams.get('conversation_id')!.replace('eq.', '')
      if (holdMessages === id) { releaseMessages = () => route.fulfill({ json: messages[id] }); return }
      return route.fulfill({ json: messages[id] })
    }
    if (path.endsWith('/functions/v1/support-actions')) {
      const body = route.request().postDataJSON(); actions.push(body)
      if (failSend) return route.fulfill({ json: { error: 'Saatmine ebaõnnestus. Proovi uuesti.' } })
      const item = conversations.find((item) => item.id === body.conversation_id)!
      if (body.action === 'admin_reply') {
        messages[item.id].push(message(`sent-${actions.length}`, body.body, 'admin', body.is_internal))
        if (!body.is_internal) item.status = 'waiting_user'
      } else if (body.action === 'status') item.status = body.status
      return route.fulfill({ json: { ok: true } })
    }
    if (path.endsWith('/platform_settings')) return route.fulfill({ json: null })
    return route.fulfill({ json: [] })
  })
  await page.routeWebSocket('**/realtime/v1/websocket**', () => {})
  await page.goto(`/admin/support${options.deepLink ? '?conversation=mavi' : ''}`)
  await expect(page.locator('.admin-support__list > button')).toHaveCount(2)
  await page.evaluate(() => document.fonts.ready)
  return { actions, failSend: (v: boolean) => { failSend = v }, failList: (v: boolean) => { failList = v }, holdMessages: (id: string) => { holdMessages = id }, releaseMessages: async () => { await expect.poll(() => Boolean(releaseMessages)).toBe(true); holdMessages = null; await releaseMessages!() } }
}

for (const viewport of [{ width: 1680, height: 1050 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 640 }, { width: 844, height: 390 }]) {
  test(`inbox uses the viewport and keeps long replies reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await setup(page, { long: true, deepLink: true })
    const thread = page.getByRole('log')
    await expect(thread).toContainText(longReply)
    const fits = async () => {
      const box = await page.locator('.admin-support').boundingBox()
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height + 1)
      await expect(page.getByRole('button', { name: 'Saada vastus', exact: true })).toBeInViewport()
    }
    await fits()
    if (viewport.width >= 1000) {
      expect((await page.locator('.admin-support__toolbar').boundingBox())!.height).toBeLessThan(70)
      expect((await page.getByRole('textbox', { name: 'Vastus', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(100)
    }
    await page.screenshot({ path: `output/admin-support-${viewport.width}.png`, animations: 'disabled' })
    const input = page.getByRole('textbox', { name: 'Vastus', exact: true })
    await input.fill(longReply)
    await fits()
    await page.getByRole('button', { name: 'Laienda kirjutamisala' }).click()
    await expect(input).toHaveValue(longReply)
    await fits()
    await page.screenshot({ path: `output/admin-support-writing-${viewport.width}.png`, animations: 'disabled' })
    await input.press('Escape')
    await expect(thread).toBeVisible()
    await fits()
    if (viewport.width <= 900) {
      await page.getByRole('button', { name: 'Tagasi vestluste juurde' }).click()
      await expect(page.getByRole('searchbox', { name: 'Otsi vestlusi' })).toBeVisible()
      await page.screenshot({ path: `output/admin-support-inbox-${viewport.width}.png`, animations: 'disabled' })
    }
  })
}

test('drafts follow the recipient, private notes stay separate, and failures preserve the reply', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 950 })
  const api = await setup(page)
  const reply = page.getByRole('textbox', { name: 'Vastus', exact: true })
  await reply.fill('Vastus Mavile')
  await page.getByRole('button', { name: 'Sisemine märkus', exact: true }).click()
  const note = page.getByRole('textbox', { name: 'Sisemine märkus', exact: true })
  await expect(note).toBeEmpty()
  await note.fill('Ainult kolleegidele')
  await page.getByRole('button', { name: 'Vastus', exact: true }).click()
  await expect(reply).toHaveValue('Vastus Mavile')
  await page.locator('.admin-support__list > button').filter({ hasText: 'Põhjala Keraamika' }).click()
  await expect(reply).toBeEmpty()
  await reply.fill('Keraamika poe mustand')
  await page.locator('.admin-support__list > button').filter({ hasText: 'Mavi Stuudio' }).click()
  await expect(reply).toHaveValue('Vastus Mavile')
  await reply.press('End')
  await reply.press('Enter')
  expect(api.actions).toEqual([])
  api.failSend(true)
  await reply.press('Control+Enter')
  await expect(page.getByRole('alert')).toContainText('Saatmine ebaõnnestus')
  await expect(reply).toHaveValue('Vastus Mavile\n')
  await page.getByRole('button', { name: 'Uuenda vestlusi' }).click()
  await expect(page.getByRole('alert')).toContainText('Saatmine ebaõnnestus')
  api.failSend(false)
  await page.getByRole('button', { name: 'Saada vastus', exact: true }).click()
  await expect(reply).toBeEmpty()
  await expect(page.getByRole('log')).toContainText('Vastus Mavile')
  expect(api.actions.at(-1)).toMatchObject({ action: 'admin_reply', conversation_id: 'mavi', is_internal: false, body: 'Vastus Mavile\n' })
  await page.getByRole('button', { name: 'Sisemine märkus', exact: true }).click()
  await expect(note).toHaveValue('Ainult kolleegidele')
  await page.getByRole('button', { name: 'Lisa märkus', exact: true }).click()
  await expect(page.getByRole('log').locator('.is-internal')).toContainText('Ainult kolleegidele')
  expect(api.actions.at(-1)).toMatchObject({ action: 'admin_reply', conversation_id: 'mavi', is_internal: true })
})

test('search, resolved conversations and refresh errors keep the inbox usable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await setup(page)
  const search = page.getByRole('searchbox', { name: 'Otsi vestlusi' })
  await search.fill('keraamika.example')
  await expect(page.locator('.admin-support__list > button')).toHaveCount(1)
  await search.fill('olematu')
  await expect(page.getByText('Vestlust ei leitud', { exact: true })).toBeVisible()
  await search.clear()
  await page.getByRole('button', { name: 'Lahendatud 1', exact: true }).click()
  await page.locator('.admin-support__list > button').click()
  await expect(page.getByRole('log')).toContainText('Kõik töötab, aitäh!')
  await page.getByLabel('Vestluse olek').selectOption('open')
  await expect.poll(() => api.actions.at(-1)).toMatchObject({ action: 'status', conversation_id: 'resolved', status: 'open' })
  await page.getByRole('button', { name: 'Aktiivsed 3', exact: true }).click()
  api.failList(true)
  await page.getByRole('button', { name: 'Uuenda vestlusi' }).click()
  await expect(page.getByRole('alert')).toContainText('Vestlusi ei õnnestunud laadida')
  await expect(page.locator('.admin-support__list > button')).toHaveCount(3)
  api.failList(false)
  await page.getByRole('button', { name: 'Proovi uuesti', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('late messages never appear under another recipient and scrolling stays under user control', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await setup(page, { long: true })
  const log = page.getByRole('log')
  await expect(log).toContainText(longReply)
  await log.evaluate((element) => { element.scrollTop = 0 })
  await expect(page.getByRole('button', { name: 'Viimased sõnumid' })).toBeVisible()
  await page.getByRole('button', { name: 'Uuenda vestlusi' }).click()
  await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBe(0)
  await page.getByRole('button', { name: 'Viimased sõnumid' }).click()
  await expect(page.getByRole('button', { name: 'Viimased sõnumid' })).not.toBeVisible()
  api.holdMessages('ceramics')
  await page.locator('.admin-support__list > button').filter({ hasText: 'Põhjala Keraamika' }).click()
  await expect(log).not.toContainText(longReply)
  await expect(log).toContainText('Laadin sõnumeid…')
  await page.locator('.admin-support__list > button').filter({ hasText: 'Mavi Stuudio' }).click()
  await expect(log).toContainText(longReply)
  await api.releaseMessages()
  await expect(log).not.toContainText('Esimene toode on lisatud. Aitan sul poe avada.')
})
