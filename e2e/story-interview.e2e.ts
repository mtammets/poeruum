import { expect, test, type Page, type Route } from '@playwright/test'
import { addStoryName, storyAnswerCount, type StoryMessage } from '../supabase/functions/_shared/story-interview'

test.use({ baseURL: 'http://poeruum.localhost:4174' })
const token = 'a'.repeat(64)
const id = 'c7310000-0000-4000-8000-000000000003'
const storeId = 'c7310000-0000-4000-8000-000000000002'
const draft = { title: 'Köögilauast oma savistuudioni', intro: 'Liisi esimene kruus valmis kodus. Täna loob ta nõusid oma väikeses töötoas.',
  opening: ['Kõik algas ühest sinisest kruusist. Liis tahtis teha midagi oma kätega.'], quote: 'Savi õpetas mulle kannatlikkust.',
  sections: [{ title: 'Esimene tellimus', paragraphs: ['Esimese kruusi ostis naaber. Ta palus teha veel ühe ka oma õele.'] }], imageCaption: 'Foto: Liisi Tamme erakogu' }

async function backend(page: Page) {
  const state = { id, storeName: 'Liisi Savipood', storeSlug: 'liisi-savipood', status: 'interview', version: 0,
    needsName: true, messages: [{ role: 'assistant', content: 'Mis on sinu nimi?', kind: 'name' }] as StoryMessage[], draft: null as typeof draft | null,
    imageUrl: null as string | null, imageAlt: '', bodyImageUrl: null as string | null, bodyImageAlt: '', bodyImageCaption: '',
    publishedUrl: null as string | null, lastRequestId: null as string | null }
  const calls: Record<string, any>[] = []
  const stores = [
    { id: storeId, name: state.storeName, slug: state.storeSlug, is_published: true },
    { id: 'c7310000-0000-4000-8000-000000000010', name: 'Avaldamata pood', slug: 'draft', is_published: false },
    { id: 'c7310000-0000-4000-8000-000000000011', name: 'Kustutatud pood', slug: 'deleted', is_published: false },
  ]
  let failAnswer = false, failGenerate = false, expired = false, hidden = false
  const story = () => ({ ...draft, ...state.draft, slug: 'liisi-lugu', category: 'Meie kaupmehed', author: state.storeName, storeName: state.storeName,
    storeSlug: state.storeSlug, publishedAt: '2026-10-18', image: '/images/kaubamaja-example-ceramics.webp', imageAlt: state.imageAlt,
    ...(state.bodyImageUrl ? { bodyImage: { src: state.bodyImageUrl, alt: state.bodyImageAlt, caption: state.bodyImageCaption } } : {}) })
  const reply = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify(body) })
  await page.route('**/__e2e_supabase/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,GET,PATCH,OPTIONS' } })
    if (path.endsWith('/functions/v1/story-interview')) {
      const body = request.postDataJSON()
      calls.push(body)
      if (body.action === 'admin-list') return reply(route, { aiAvailable: true, stores,
        interviews: (calls.some((call) => call.action === 'admin-create') || ['pending_review', 'published'].includes(state.status)) ? [{ id, store_id: storeId, store_name: state.storeName, status: expired ? 'revoked' : state.status, expires_at: '2099-11-18', created_at: '2026-10-18',
          article: state.status === 'published' ? { id, slug: 'liisi-lugu', is_published: !hidden } : null }] : [] })
      if (body.action === 'admin-create' || body.action === 'admin-renew') return reply(route, { id, token })
      if (body.action === 'admin-review') return reply(route, { interview: state })
      if (body.action === 'admin-approve') {
        state.status = 'published'; state.version++; state.publishedUrl = 'http://kaubamaja.poeruum.localhost:4174/lood/liisi-lugu/'
        return reply(route, { interview: state })
      }
      if (body.action === 'admin-revoke') { expired = true; return reply(route, { id }) }
      if (body.action === 'admin-visibility') { hidden = !body.published; return reply(route, { ok: true }) }
      if (expired || body.token !== token) return reply(route, { error: 'See intervjuulink ei kehti enam.' }, 410)
      if (body.action === 'load') return reply(route, { interview: state })
      if (body.requestId === state.lastRequestId) return reply(route, { interview: state })
      if (body.version !== state.version) return reply(route, { error: 'Vestlus on vahepeal muutunud. Laadi see uuesti.' }, 409)
      if (body.action === 'name') {
        state.messages = addStoryName(state.messages, body.answer, state.storeName)
        state.needsName = false
      }
      if (body.action === 'answer') {
        if (failAnswer) return reply(route, { error: 'Ühendus katkes. Proovi uuesti.' }, 500)
        await new Promise((resolve) => setTimeout(resolve, 150))
        state.messages.push({ role: 'user', content: body.answer })
        const count = storyAnswerCount(state.messages)
        if (count >= 3) { state.status = 'photo'; state.messages.push({ role: 'assistant', content: 'Lisa loole foto endast, oma töötoast või loomingust.' }) }
        else state.messages.push({ role: 'assistant', content: count === 1 ? 'Milline sinu esimene kruus oli?' : 'Kuidas jõudis esimene kruus ostjani?' })
      }
      if (body.action === 'upload') {
        expect(body.image).toMatch(/^data:image\/webp;base64,/)
        if (body.slot === 'body') { state.bodyImageUrl = '/images/kaubamaja-example-ceramics.webp'; state.bodyImageAlt ||= state.storeName }
        else { state.imageUrl = '/images/kaubamaja-example-ceramics.webp'; state.imageAlt ||= state.storeName }
      }
      if (body.action === 'remove-image') { state.bodyImageUrl = null; state.bodyImageAlt = ''; state.bodyImageCaption = '' }
      if (body.action === 'generate') {
        if (failGenerate) return reply(route, { error: 'Loo kirjutamine katkes. Proovi uuesti.' }, 500)
        state.draft = structuredClone(draft); state.status = 'preview'
      }
      if (body.action === 'save') {
        state.draft = body.draft; state.imageAlt = body.imageAlt
        if (state.bodyImageUrl) { state.bodyImageAlt = body.bodyImageAlt; state.bodyImageCaption = body.bodyImageCaption }
      }
      if (body.action === 'submit' || body.action === 'publish') state.status = 'pending_review'
      state.version++; state.lastRequestId = body.requestId
      return reply(route, { interview: state })
    }
    if (path.endsWith('/directory_stories')) return reply(route, request.url().includes('slug=')
      ? state.status === 'published' && !hidden ? { story: story() } : null
      : state.status === 'published' && !hidden ? [{ story: story() }] : [])
    if (path.endsWith('/platform_settings')) return reply(route, null)
    return reply(route, [])
  })
  return { state, stores, calls, failAnswer: (value: boolean) => { failAnswer = value }, failGenerate: (value: boolean) => { failGenerate = value }, expire: () => { expired = true } }
}

async function answerQuestions(page: Page) {
  await answerName(page)
  for (const answer of ['Alustasin köögilaua taga kruuside tegemisega.', 'See oli sinine ja natuke viltune. Savi õpetas mulle kannatlikkust.', 'Naaber nägi kruusi ja tahtis samasugust oma õele.']) {
    await page.getByRole('textbox', { name: 'Sinu vastus' }).fill(answer)
    await page.getByRole('button', { name: 'Saada vastus' }).click()
    await expect(page.locator('.story-interview__working')).toHaveCount(0)
  }
}

async function answerName(page: Page) {
  await expect(page.getByText('Mis on sinu nimi?')).toBeVisible()
  await page.getByRole('textbox', { name: 'Sinu vastus' }).fill('Liis Tamm')
  await page.getByRole('button', { name: 'Saada vastus' }).click()
  await expect(page.locator('.story-interview__working')).toHaveCount(0)
}

test('merchant completes a mobile interview, resumes, adds two photos, edits and submits for admin approval before appearing in the directory', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const api = await backend(page)
  await page.goto(`/lugu/#token=${token}`)
  await expect(page.getByText('Mis on sinu nimi?')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  await page.screenshot({ path: 'output/story-interview-mobile.png', fullPage: true })
  await answerQuestions(page)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Lisa foto' })).toBeVisible()
  expect(storyAnswerCount(api.state.messages)).toBe(3)
  await page.getByLabel('Lisa foto', { exact: true }).setInputFiles('public/images/kaubamaja-example-ceramics.webp')
  await expect(page.getByRole('button', { name: 'Lisa teine foto' })).toBeEnabled()
  await page.getByLabel('Lisa teine foto', { exact: true }).setInputFiles('public/images/kaubamaja-example-ceramics.webp')
  await expect(page.locator('.story-interview__photos img')).toHaveCount(2)
  await page.screenshot({ path: 'output/story-two-photo-upload-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Loo eelvaade' }).click()
  await expect(page.getByRole('heading', { name: draft.title })).toBeVisible()
  await expect(page.locator('.directory-story-hero')).toHaveClass(/is-expanded/)
  await expect(page.getByRole('heading', { name: 'Esimene tellimus' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Loe edasi' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Tagasi', exact: true })).toHaveCount(0)
  await expect(page.locator('figcaption')).toHaveText('Foto: Liisi Tamme erakogu')
  await expect(page.locator('.directory-story-page__body-image img')).toBeVisible()
  await expect(page.getByText('Meie kaupmehed', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/\d+ min lugemist/)).toHaveCount(0)
  expect(api.calls.filter((call) => call.action === 'submit')).toHaveLength(0)
  await page.screenshot({ path: 'output/story-preview-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Muuda', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Pildiallkiri', exact: true })).toHaveValue('Foto: Liisi Tamme erakogu')
  await page.getByRole('textbox', { name: 'Pealkiri', exact: true }).fill('Sinine kruus ja uus algus')
  await page.getByRole('textbox', { name: 'Pildiallkiri', exact: true }).fill('Liisi esimene kruus.')
  await page.getByRole('textbox', { name: 'Teise foto allkiri', exact: true }).fill('Nõud Liisi töötoas.')
  await page.getByRole('textbox', { name: 'Teise foto kirjeldus', exact: true }).fill('Kausid ja kruusid töötoas')
  await page.getByRole('button', { name: 'Salvesta', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sinine kruus ja uus algus' })).toBeVisible()
  await page.getByRole('button', { name: 'Fotod', exact: true }).click()
  const photoChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Vaheta avafotot' }).click()
  await (await photoChooser).setFiles('public/images/kaubamaja-example-ceramics.webp')
  await expect(page.getByRole('button', { name: 'Salvesta', exact: true })).toBeEnabled()
  expect(api.calls.filter((call) => call.action === 'upload')).toHaveLength(3)
  await page.getByRole('button', { name: 'Salvesta', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Sinine kruus ja uus algus' })).toBeVisible()
  await expect(page.locator('figcaption')).toHaveText(['Liisi esimene kruus.', 'Nõud Liisi töötoas.'])
  await expect(page.getByRole('img', { name: 'Kausid ja kruusid töötoas' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: 'Valmis', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Aitäh! Sinu lugu on valmis.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Vaata oma lugu' })).toHaveCount(0)
  await expect(page.getByText('Lugu ootab Poeruumi administraatori kinnitust.', { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Aitäh! Sinu lugu on valmis.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Muuda', exact: true })).toHaveCount(0)
  await page.goto('http://kaubamaja.poeruum.localhost:4174/')
  await expect(page.getByRole('heading', { name: 'Sinine kruus ja uus algus' })).toHaveCount(0)
  await approveSubmittedStory(page)
  await page.goto(`/lugu/#token=${token}`)
  await expect(page.getByRole('heading', { name: 'Sinu lugu on avaldatud.' })).toBeVisible()
  await page.getByRole('link', { name: 'Vaata oma lugu' }).click()
  await expect(page.getByRole('heading', { name: 'Sinine kruus ja uus algus' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Kausid ja kruusid töötoas' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Külasta poodi' })).toHaveAttribute('href', 'https://liisi-savipood.poeruum.ee/?from=kaubamaja')
  await page.goto('http://kaubamaja.poeruum.localhost:4174/')
  const hero = page.locator('.directory-story-hero')
  await hero.getByRole('button', { name: 'Loe edasi' }).click()
  await expect(page).toHaveURL('http://kaubamaja.poeruum.localhost:4174/')
  await expect(hero.getByRole('heading', { level: 1, name: 'Sinine kruus ja uus algus' })).toBeVisible()
  await expect(hero.locator('figcaption')).toHaveText(['Liisi esimene kruus.', 'Nõud Liisi töötoas.'])
  await expect(hero.getByRole('img', { name: 'Kausid ja kruusid töötoas' })).toBeVisible()
  await expect(hero.getByRole('link', { name: 'Külasta poodi' })).toHaveAttribute('href', 'https://liisi-savipood.poeruum.ee/?from=kaubamaja')
  await hero.locator('.directory-story-hero__close').click()
  await expect(hero.getByRole('button', { name: 'Loe edasi' })).toBeFocused()
  expect(api.calls.filter((call) => call.action === 'submit')).toHaveLength(1)
})

test('an older server cannot accidentally replace the cover with a second photo', async ({ page }) => {
  const api = await backend(page)
  Object.assign(api.state, { status: 'preview', needsName: false, draft: structuredClone(draft),
    imageUrl: '/images/kaubamaja-example-ceramics.webp', imageAlt: 'Avafoto' })
  await page.route('**/__e2e_supabase/functions/v1/story-interview', async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().action !== 'load') return route.fallback()
    const legacy: Record<string, unknown> = { ...api.state }
    delete legacy.bodyImageUrl
    await route.fulfill({ json: { interview: legacy }, headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  await page.goto(`/lugu/#token=${token}`)
  await page.getByRole('button', { name: 'Fotod', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Lisa teine foto' })).toHaveCount(0)
  await page.getByLabel('Lisa teine foto', { exact: true }).setInputFiles('public/images/kaubamaja-example-ceramics.webp')
  await expect(page.getByRole('alert')).toContainText('Teise foto lisamine pole veel saadaval')
  expect(api.calls.filter(call => call.action === 'upload')).toHaveLength(0)
  await expect(page.getByRole('img', { name: 'Avafoto' })).toBeVisible()
})

test('the optional second photo can be added, replaced and removed without changing the cover', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  const api = await backend(page)
  Object.assign(api.state, { status: 'preview', needsName: false, draft: structuredClone(draft),
    imageUrl: '/images/kaubamaja-example-ceramics.webp', imageAlt: 'Avafoto kruusist' })
  await page.goto(`/lugu/#token=${token}`)
  await page.getByRole('button', { name: 'Fotod', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Lisa teine foto' })).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Lisa teine foto' }).click()
  await (await chooser).setFiles('public/images/kaubamaja-example-ceramics.webp')
  await expect(page.locator('.story-interview__photos img')).toHaveCount(2)
  await page.getByRole('textbox', { name: 'Teise foto allkiri' }).fill('Töötoa nõud.')
  await page.getByRole('textbox', { name: 'Teise foto kirjeldus' }).fill('Nõud laual')
  await page.getByRole('button', { name: 'Salvesta', exact: true }).click()
  await expect(page.locator('.directory-story-page__body-image figcaption')).toHaveText('Töötoa nõud.')
  await page.reload()
  await expect(page.getByRole('img', { name: 'Nõud laual' })).toBeVisible()
  await page.getByRole('button', { name: 'Fotod', exact: true }).click()
  await page.getByLabel('Lisa teine foto', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') })
  await expect(page.getByRole('alert')).toContainText('Vali JPG-')
  await expect(page.locator('.story-interview__photos img')).toHaveCount(2)
  expect(api.calls.filter(call => call.action === 'upload')).toHaveLength(1)
  const replacement = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Vaheta teist fotot' }).click()
  await (await replacement).setFiles('public/images/kaubamaja-example-ceramics.webp')
  await expect(page.getByRole('button', { name: 'Salvesta', exact: true })).toBeEnabled()
  await expect(page.getByRole('textbox', { name: 'Teise foto allkiri' })).toHaveValue('Töötoa nõud.')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.screenshot({ path: 'output/story-photo-editor-320.png', fullPage: true })
  await page.getByRole('button', { name: 'Eemalda teine foto' }).click()
  await expect(page.locator('.story-interview__photos img')).toHaveCount(1)
  await page.getByRole('button', { name: 'Salvesta', exact: true }).click()
  await expect(page.locator('.directory-story-page__body-image')).toHaveCount(0)
  await page.getByRole('button', { name: 'Valmis', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Aitäh! Sinu lugu on valmis.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Vaata oma lugu' })).toHaveCount(0)
  await approveSubmittedStory(page)
  await page.goto(`/lugu/#token=${token}`)
  await page.getByRole('link', { name: 'Vaata oma lugu' }).click()
  await expect(page.getByRole('img', { name: 'Avafoto kruusist' })).toBeVisible()
  await expect(page.locator('.directory-story-page__body-image')).toHaveCount(0)
  expect(api.calls.filter(call => call.action === 'upload').map(call => call.slot)).toEqual(['body', 'body'])
})

for (const width of [1440, 320]) {
  test(`the interview preview matches the published article layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const api = await backend(page)
    Object.assign(api.state, { status: 'preview', needsName: false, draft: structuredClone(draft),
      imageUrl: '/images/kaubamaja-example-ceramics.webp', imageAlt: 'Kruus',
      bodyImageUrl: '/images/kaubamaja-example-ceramics.webp', bodyImageAlt: 'Nõud', bodyImageCaption: 'Foto töötoast.' })
    const measureArticle = () => page.locator('.directory-story-hero').evaluate((hero) => {
      const bounds = hero.getBoundingClientRect()
      return ['.directory-story-hero__byline', '.directory-story-hero__intro h1', '.directory-story-hero__excerpt',
        '.directory-story-hero__figure img', '.directory-story-hero__figure figcaption',
        '.directory-story-page__body > p:first-child', '.directory-story-page__body blockquote', '.directory-story-page__body > section h2',
        '.directory-story-page__body-image img', '.directory-story-page__body-image figcaption',
      ].map((selector) => {
        const element = hero.querySelector(selector)!
        const box = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return { selector, x: Math.round(box.x - bounds.x), y: Math.round(box.y - bounds.y),
          width: Math.round(box.width), height: Math.round(box.height),
          font: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight, color: style.color }
      })
    })

    await page.goto(`/lugu/#token=${token}`)
    const hero = page.locator('.directory-story-hero')
    await expect(hero.getByRole('heading', { name: draft.title })).toBeInViewport()
    await expect(hero.getByRole('heading', { name: 'Esimene tellimus' })).toBeVisible()
    await expect(hero.getByRole('button')).toHaveCount(0)
    await expect(hero.getByRole('link', { name: 'Külasta poodi' })).toHaveCount(0)
    await expect(hero.locator('.directory-story-hero__byline')).toHaveText(api.state.storeName)
    await page.evaluate(() => document.fonts.ready)
    const previewLayout = await measureArticle()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await expect(page.getByRole('button', { name: 'Muuda', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Fotod', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Valmis', exact: true })).toBeInViewport()
    expect(api.calls.filter((call) => call.action === 'submit')).toHaveLength(0)
    await page.screenshot({ path: `output/story-preview-magazine-${width}.png`, fullPage: true })

    await page.getByRole('button', { name: 'Valmis', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Aitäh! Sinu lugu on valmis.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Vaata oma lugu' })).toHaveCount(0)
    await approveSubmittedStory(page)
    await page.goto(`/lugu/#token=${token}`)
    await expect(page.getByRole('heading', { name: 'Sinu lugu on avaldatud.' })).toBeVisible()
    await page.goto('http://kaubamaja.poeruum.localhost:4174/')
    await page.getByRole('button', { name: 'Loe edasi' }).click()
    await expect(page.locator('.directory-story-hero__expansion')).toHaveAttribute('aria-hidden', 'false')
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(measureArticle).toEqual(previewLayout)
    expect(api.calls.filter((call) => call.action === 'submit')).toHaveLength(1)
  })
}

test('a legacy preview asks for the name and resumes with its saved photo and edits', async ({ page }) => {
  const api = await backend(page)
  api.state.status = 'preview'
  api.state.draft = { ...draft, title: 'Minu parandatud pealkiri', imageCaption: 'Minu esimene kruus.' }
  api.state.imageUrl = '/images/kaubamaja-example-ceramics.webp'
  api.state.imageAlt = 'Sinine kruus'
  api.state.messages = [{ role: 'assistant', content: 'Kuidas alustasid?' }, { role: 'user', content: 'Alustasin kodus.' }]
  await page.goto(`/lugu/#token=${token}`)
  await expect(page.getByRole('heading', { name: 'Minu parandatud pealkiri' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Valmis', exact: true })).toHaveCount(0)
  await answerName(page)
  await expect(page.getByRole('heading', { name: 'Minu parandatud pealkiri' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Sinine kruus' })).toBeVisible()
  await expect(page.getByText('Minu esimene kruus.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Valmis', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Sinu vastus' })).toHaveCount(0)
  expect(api.calls.filter((call) => call.action === 'name')).toHaveLength(1)
  expect(api.calls.filter((call) => call.action === 'submit')).toHaveLength(0)
})

for (const action of ['name', 'answer']) {
  test(`sending ${action} clears the composer before the response and shows the message only once`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const api = await backend(page)
    await page.goto(`/lugu/#token=${token}`)
    if (action === 'answer') await answerName(page)
    let release!: () => void
    const response = new Promise<void>((resolve) => { release = resolve })
    await page.route('**/__e2e_supabase/functions/v1/story-interview', async (route) => {
      if (route.request().postDataJSON()?.action === action) await response
      await route.fallback()
    })
    const answer = page.getByRole('textbox', { name: 'Sinu vastus' })
    const text = action === 'name' ? 'Liis Tamm' : 'Alustasin köögilaua taga kruuside tegemisega. Savi õpetas mulle kannatlikkust.'
    const message = page.getByRole('log').locator('.story-interview__message--user').filter({ hasText: text })
    await answer.fill(text)
    const filledHeight = await answer.evaluate((element) => element.clientHeight)
    try {
      await page.getByRole('button', { name: 'Saada vastus' }).click()
      await expect(page.locator('.story-interview__working')).toBeVisible()
      await expect(answer).toHaveValue('')
      await expect(message).toHaveCount(1)
      await expect(page.getByRole('button', { name: 'Saada vastus' })).toBeDisabled()
      if (action === 'answer') await expect.poll(() => answer.evaluate((element) => element.clientHeight)).toBeLessThan(filledHeight)
    } finally { release() }
    await expect(page.locator('.story-interview__working')).toHaveCount(0)
    await expect(answer).toHaveValue('')
    await expect(message).toHaveCount(1)
    expect(api.calls.filter((call) => call.action === action)).toHaveLength(1)
  })
}

test('failed answer and generation preserve input, uploaded photo and request identity for retry', async ({ page }) => {
  const api = await backend(page)
  await page.goto(`/lugu/#token=${token}`)
  await answerName(page)
  api.failAnswer(true)
  const answer = page.getByRole('textbox', { name: 'Sinu vastus' })
  await answer.fill('Alustasin kodus.')
  await page.getByRole('button', { name: 'Saada vastus' }).click()
  await expect(page.getByRole('alert')).toContainText('Ühendus katkes')
  await expect(answer).toHaveValue('Alustasin kodus.')
  await expect(page.getByRole('log').getByText('Alustasin kodus.', { exact: true })).toHaveCount(0)
  api.failAnswer(false)
  await page.getByRole('button', { name: 'Saada vastus' }).click()
  await expect(page.getByText('Milline sinu esimene kruus oli?')).toBeVisible()
  await expect(answer).toHaveValue('')
  await expect(page.getByRole('log').locator('.story-interview__message--user').filter({ hasText: 'Alustasin kodus.' })).toHaveCount(1)
  const attempts = api.calls.filter((call) => call.action === 'answer')
  expect(attempts[0].requestId).toBe(attempts[1].requestId)
  for (const text of ['Sinine.', 'Naaber ostis.']) {
    await answer.fill(text); await page.getByRole('button', { name: 'Saada vastus' }).click()
    await expect(page.locator('.story-interview__working')).toHaveCount(0)
  }
  api.failGenerate(true)
  await page.getByLabel('Lisa foto', { exact: true }).setInputFiles('public/images/kaubamaja-example-ceramics.webp')
  await page.getByRole('button', { name: 'Loo eelvaade' }).click()
  await expect(page.getByRole('alert')).toContainText('Loo kirjutamine katkes')
  await expect(page.locator('.story-interview__photo img')).toBeVisible()
  api.failGenerate(false)
  await page.getByRole('button', { name: 'Loo eelvaade' }).click()
  await expect(page.getByRole('heading', { name: draft.title })).toBeVisible()
  expect(api.calls.filter((call) => call.action === 'upload')).toHaveLength(1)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'output/story-preview-desktop.png', fullPage: true })
})

test('missing and expired links stay private and a stale tab recovers without losing the unsent answer', async ({ page }) => {
  const api = await backend(page)
  await page.goto('/lugu/')
  await expect(page.getByRole('heading', { name: 'See link ei kehti enam.' })).toBeVisible()
  expect(api.calls).toHaveLength(0)
  await page.goto(`/lugu/#token=${token}`)
  await expect(page.getByText('Mis on sinu nimi?')).toBeVisible()
  api.state.version++
  await page.getByRole('textbox', { name: 'Sinu vastus' }).fill('Minu vastus jääb alles.')
  await page.getByRole('button', { name: 'Saada vastus' }).click()
  await expect(page.getByRole('alert')).toContainText('vahepeal muutunud')
  await expect(page.getByRole('textbox', { name: 'Sinu vastus' })).toHaveValue('Minu vastus jääb alles.')
  api.expire()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'See link ei kehti enam.' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Sinu vastus' })).toHaveCount(0)
})

test('long answers keep the next question above the mobile composer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await backend(page)
  await page.goto(`/lugu/#token=${token}`)
  await answerName(page)
  await page.getByRole('textbox', { name: 'Sinu vastus' }).fill('Alustasin köögilaua taga. '.repeat(65))
  await page.getByRole('button', { name: 'Saada vastus' }).click()
  const question = page.getByText('Milline sinu esimene kruus oli?')
  await expect(question).toBeVisible()
  await expect.poll(async () => {
    const questionBox = await question.boundingBox()
    const composerBox = await page.locator('.story-interview__composer').boundingBox()
    return Boolean(questionBox && composerBox && questionBox.y >= 0 && questionBox.y + questionBox.height <= composerBox.y)
  }).toBe(true)
})

async function adminSession(page: Page) {
  const user = { id: 'c7310000-0000-4000-8000-000000000001', email: 'admin@example.invalid', aud: 'authenticated', role: 'authenticated',
    app_metadata: { role: 'admin' }, user_metadata: {}, created_at: '2026-10-18' }
  const jwt = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', app_metadata: user.app_metadata, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'test'].join('.')
  const session = { access_token: jwt, refresh_token: 'test', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  await page.addInitScript((session) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session)), session)
  await page.route('**/__e2e_supabase/auth/v1/user', (route) => route.fulfill({ json: user }))
  await page.route('**/__e2e_supabase/auth/v1/token*', (route) => route.fulfill({ json: session }))
}

async function approveSubmittedStory(page: Page) {
  await adminSession(page)
  await page.goto('/admin/kaubamaja?view=stories')
  await expect(page.getByText('Ootab kinnitamist', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Kinnita ja avalda' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Vaata üle' }).click()
  await expect(page.getByRole('heading', { name: 'Loo kinnitamine' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Esimene tellimus' })).toBeVisible()
  await expect(page.locator('.admin-stories__review img').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: `output/story-admin-review-${page.viewportSize()!.width}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Kinnita ja avalda' }).click()
  await expect(page.getByRole('link', { name: 'Vaata lugu ↗' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Vaata üle' })).toHaveCount(0)
}

test('admin can retry a failed list request without a stuck loading message', async ({ page }) => {
  await backend(page)
  await adminSession(page)
  await page.route('**/__e2e_supabase/functions/v1/story-interview', (route) => route.abort('failed'))
  await page.goto('/admin/kaubamaja?view=stories')
  await expect(page.getByRole('alert')).toContainText('Ühendus katkes')
  await expect(page.getByText('Laadin lugusid…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Värskenda', exact: true })).toBeEnabled()
  await page.unroute('**/__e2e_supabase/functions/v1/story-interview')
  await page.getByRole('button', { name: 'Värskenda', exact: true }).click()
  await expect(page.getByLabel('Kaupmees', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Laadin lugusid…')).toHaveCount(0)
})

test('admin creates a shop-specific link and revokes it', async ({ page }) => {
  const api = await backend(page)
  await adminSession(page)
  await page.goto('/admin/kaubamaja?view=stories')
  await page.getByLabel('Kaupmees', { exact: true }).selectOption(storeId)
  await page.getByRole('button', { name: 'Loo intervjuulink' }).click()
  const publicLink = `https://poeruum.ee/lugu/#token=${token}`
  await expect(page.getByLabel('Intervjuulink', { exact: true })).toHaveValue(publicLink)
  await expect(page.getByRole('link', { name: 'Ava intervjuu ↗' })).toHaveAttribute('href', publicLink)
  await expect(page.getByRole('link', { name: 'Ava SMS-is' })).toHaveAttribute('href', `sms:?&body=${encodeURIComponent(`Jaga oma poe lugu Poeruumis: ${publicLink}`)}`)
  expect(api.calls.find((call) => call.action === 'admin-create')?.storeId).toBe(storeId)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'output/story-admin-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Sulge link' }).click()
  await expect(page.getByText('Link suletud', { exact: false })).toBeVisible()
  await page.goto(`/lugu/#token=${token}`)
  await expect(page.getByRole('heading', { name: 'See link ei kehti enam.' })).toBeVisible()
})

test('admin only selects published stores and cannot reuse a selection after unpublishing', async ({ page }) => {
  const api = await backend(page)
  await adminSession(page)
  await page.goto('/admin/kaubamaja?view=stories')
  const select = page.getByLabel('Kaupmees', { exact: true })
  await expect(select.locator('option')).toHaveText(['Vali pood', 'Liisi Savipood'])
  await select.selectOption(storeId)
  await page.getByRole('button', { name: 'Loo intervjuulink' }).click()
  await expect(page.getByLabel('Intervjuulink', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Värskenda', exact: true })).toBeEnabled()
  api.stores[0].is_published = false
  await page.getByRole('button', { name: 'Värskenda', exact: true }).click()
  await expect(select.locator('option')).toHaveText(['Vali pood'])
  await expect(select).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Loo intervjuulink' })).toBeDisabled()
  await expect(page.getByRole('list', { name: 'Intervjuud' })).toContainText('Liisi Savipood')
  expect(api.calls.filter((call) => call.action === 'admin-create')).toHaveLength(1)
})
