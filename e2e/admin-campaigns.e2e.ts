import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { BlobSource, Input, MP4 } from 'mediabunny'

test.use({ baseURL: 'http://poeruum.localhost:4174' })

async function backend(page: Page, options: { admin?: boolean; aiError?: boolean; cloudError?: boolean } = {}) {
  const user = { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { role: options.admin === false ? 'merchant' : 'admin' }, user_metadata: {}, created_at: new Date().toISOString() }
  const expires = Math.floor(Date.now() / 1000) + 3600
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', app_metadata: user.app_metadata, exp: expires })).toString('base64url'), 'test-signature'].join('.')
  const session = { access_token: token, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expires, user }
  await page.addInitScript((session) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session)), session)
  const versions: any[] = []
  const aiRequests: any[] = []
  await page.route('**/__e2e_supabase/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/v1/user')) return route.fulfill({ json: user })
    if (path.endsWith('/auth/v1/token')) return route.fulfill({ json: session })
    if (path.endsWith('/admin-campaign-copy')) {
      const body = route.request().postDataJSON()
      if (body.action === 'capabilities') return route.fulfill({ json: { available: true, estimatedCostUsd: .02 } })
      aiRequests.push(body)
      if (options.aiError) return route.fulfill({ status: 503, json: { error: 'AI tekstide loomine ebaõnnestus. Proovi uuesti või vali mallitekstid.' } })
      return route.fulfill({ json: { copy: { headlines: ['Looming leiab oma poe.', 'Sinu pood ootab.', 'Alusta oma lugu.'], support: 'Loo oma e-pood telefonist.', cta: 'Alusta tasuta', captionShort: 'Sinu looming väärib oma poodi.', captionLong: 'Loo oma e-pood telefonist ja lisa oma tooted. Alusta Poeruumis tasuta.', adTitle: 'Sinu looming. Oma pood.' } } })
    }
    if (path.endsWith('/admin_campaign_versions')) {
      if (options.cloudError) return route.fulfill({ status: 503, json: { message: 'Unavailable' } })
      if (route.request().method() === 'POST') {
        const row = { ...route.request().postDataJSON(), created_at: new Date().toISOString() }; versions.unshift(row)
        return route.fulfill({ json: row })
      }
      const id = new URL(route.request().url()).searchParams.get('id')?.replace('eq.', '')
      return route.fulfill({ json: id ? versions.find((row) => row.id === id) : versions })
    }
    if (path.endsWith('/platform_settings')) return route.fulfill({ json: null })
    return route.fulfill({ json: [] })
  })
  return { versions, aiRequests }
}

test('admin creates a complete campaign ZIP with playable MP4s, edits and restores a version', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const { versions } = await backend(page)
  await page.goto('/admin/campaigns')
  await expect(page.getByRole('heading', { name: 'Kampaaniad', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Kampaaniad', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Laadin eelvaadet…')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('campaign-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Loo failid' }).click()
  await expect(page.getByRole('button', { name: 'Laadi ZIP' }).or(page.getByRole('alert'))).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(versions).toHaveLength(1)
  await page.getByRole('button', { name: 'Vaata valmis videot' }).click()
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.duration)).toBeGreaterThanOrEqual(12)
  // Check the encoded file's screen content, not movement of the phone frame:
  // the product photo must scroll away into real dark product details, then back.
  const blackPixels = []
  const phoneWidths: number[] = []
  for (const time of [.6, 2.6, 4.3, 5.7, 8.5, 10.5]) {
    blackPixels.push(await page.locator('video').evaluate(async (video: HTMLVideoElement, time) => {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('seeked', () => resolve(), { once: true })
        video.addEventListener('error', () => reject(new Error('Video seek failed')), { once: true })
        video.currentTime = time
      })
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 100
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 370, 800, 330, 550, 0, 0, 80, 100)
      const pixels = ctx.getImageData(0, 0, 80, 100).data
      let black = 0
      for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 30) black++
      return black / (80 * 100)
    }, time))
    phoneWidths.push(await page.locator('video').evaluate((video: HTMLVideoElement) => {
      const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1
      const ctx = canvas.getContext('2d')!; ctx.drawImage(video, 0, 914, 1080, 1, 0, 0, 1080, 1)
      const pixels = ctx.getImageData(0, 0, 1080, 1).data, edges: number[] = []
      for (let x = 100; x < 980; x++) if (Math.max(pixels[x * 4], pixels[x * 4 + 1], pixels[x * 4 + 2]) < 95) edges.push(x)
      return edges.length ? edges.at(-1)! - edges[0] : 0
    }))
    await page.locator('video').screenshot({ path: testInfo.outputPath(`reel-${time}.png`) })
  }
  expect(blackPixels[1]).toBeGreaterThan(.6)
  expect(blackPixels[1] - blackPixels[0]).toBeGreaterThan(.35)
  expect(blackPixels[1] - blackPixels[2]).toBeGreaterThan(.35)
  expect(phoneWidths[4] - phoneWidths[0]).toBeGreaterThan(25)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Laadi ZIP' }).click()
  const download = await downloading
  const archive = unzipSync(new Uint8Array(await readFile((await download.path())!)))
  expect(Object.keys(archive)).toHaveLength(11)
  expect(strFromU8(archive['tekstid.txt'])).toContain('utm_campaign=')
  expect(archive['post-1.jpg'][0]).toBe(0xff)
  await writeFile(testInfo.outputPath('reels-heliga.mp4'), archive['reels-heliga.mp4'])
  for (const name of ['reels-helita.mp4', 'reels-heliga.mp4']) {
    const input = new Input({ source: new BlobSource(new Blob([archive[name]])), formats: [MP4] })
    const track = await input.getPrimaryVideoTrack()
    expect(track?.displayWidth).toBe(1080); expect(track?.displayHeight).toBe(1920)
    expect(await input.computeDuration()).toBeCloseTo(12, 0)
    expect(Boolean(await input.getPrimaryAudioTrack())).toBe(name.includes('heliga'))
    input.dispose()
  }
  await page.getByRole('tab', { name: 'Tekstid', exact: true }).click()
  await page.getByRole('textbox', { name: 'Pealkiri 1', exact: true }).fill('Muudetud kampaania')
  await expect(page.getByRole('button', { name: 'Laadi ZIP' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Salvesta versioon', exact: true }).click()
  await expect.poll(() => versions.length).toBe(2)
  await page.reload()
  await page.getByRole('tab', { name: 'Tekstid', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Pealkiri 1', exact: true })).toHaveValue('Muudetud kampaania')
  await page.getByRole('button', { name: /Versioonid/ }).click()
  await page.getByRole('region', { name: 'Kampaaniate versioonid' }).getByRole('button', { name: /Sinu looming/ }).last().click()
  await expect(page.getByRole('textbox', { name: 'Pealkiri 1', exact: true })).toHaveValue('Sinu looming. Sinu pood.')
})

test('AI failure retains edited copy and allows a free template retry', async ({ page }) => {
  const { aiRequests } = await backend(page, { aiError: true })
  await page.goto('/admin/campaigns')
  await page.getByRole('tab', { name: 'Tekstid', exact: true }).click()
  await page.getByRole('textbox', { name: 'Pealkiri 1', exact: true }).fill('Minu enda sõnum')
  await page.getByRole('checkbox', { name: /Loo uued tekstid AI-ga/ }).check()
  await page.getByRole('button', { name: 'Loo failid' }).click()
  await expect(page.getByRole('alert')).toContainText('AI tekstide loomine ebaõnnestus')
  await expect(page.getByRole('textbox', { name: 'Pealkiri 1', exact: true })).toHaveValue('Minu enda sõnum')
  expect(aiRequests).toHaveLength(1)
  await expect(page.getByRole('button', { name: 'Loo failid' })).toBeEnabled()
})

test('unsupported MP4 keeps images and text downloadable; mobile layout and local history work', async ({ page }, testInfo) => {
  await backend(page, { cloudError: true })
  await page.addInitScript(() => { Object.defineProperty(window, 'VideoEncoder', { value: undefined, configurable: true }) })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin/campaigns')
  await page.getByRole('button', { name: 'Tekst', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('campaign-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Loo failid' }).click()
  await expect(page.getByRole('alert')).toContainText('ei toeta MP4')
  await expect(page.getByRole('button', { name: 'Laadi valmis failid' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Jätka loomist' })).toBeEnabled()
  await page.getByRole('button', { name: /Versioonid/ }).click()
  await expect(page.getByRole('region', { name: 'Kampaaniate versioonid' })).toContainText('Selles brauseris')
})

test('merchant cannot open the admin campaign editor', async ({ page }) => {
  await backend(page, { admin: false })
  await page.goto('/admin/campaigns')
  await expect(page.getByRole('heading', { name: 'Administraatori töölaud' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Loo failid' })).toHaveCount(0)
})

test('AI copy survives a failed video export and retry does not bill AI again', async ({ page }) => {
  const { aiRequests } = await backend(page)
  await page.addInitScript(() => { Object.defineProperty(window, 'VideoEncoder', { value: undefined, configurable: true }) })
  await page.goto('/admin/campaigns')
  await page.getByRole('checkbox', { name: /Loo uued tekstid AI-ga/ }).check()
  await page.getByRole('button', { name: 'Loo failid' }).click()
  await expect(page.getByRole('alert')).toContainText('ei toeta MP4')
  await page.getByRole('tab', { name: 'Tekstid', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Pealkiri 1', exact: true })).toHaveValue('Looming leiab oma poe.')
  await expect(page.getByRole('checkbox', { name: /Loo uued tekstid AI-ga/ })).not.toBeChecked()
  await page.getByRole('button', { name: 'Jätka loomist' }).click()
  await expect(page.getByRole('alert')).toContainText('ei toeta MP4')
  expect(aiRequests).toHaveLength(1)
})

test('uploaded photos persist and affect the preview without a network upload', async ({ page }) => {
  await backend(page)
  await page.goto('/admin/campaigns')
  await page.locator('.campaigns__media:not(.campaign-phone) > summary').click()
  await page.locator('input[type=file]').first().setInputFiles('public/images/kaubamaja-example-art.webp')
  await expect(page.locator('.campaigns__media-row img').first()).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
  await expect(page.getByRole('checkbox', { name: 'Poe ekraanipilt' }).first()).not.toBeChecked()
  await page.getByRole('textbox', { name: 'Alternatiivtekst 1', exact: true }).fill('Värviline kunstiteos')
  await expect(page.getByText('Mustand selles brauseris', { exact: true })).toBeVisible()
  await page.reload()
  await page.locator('.campaigns__media:not(.campaign-phone) > summary').click()
  await expect(page.getByRole('textbox', { name: 'Alternatiivtekst 1', exact: true })).toHaveValue('Värviline kunstiteos')
  await expect(page.locator('.campaigns__media-row img').first()).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
})

test('canvas dragging, resize, undo, visibility and per-format layouts survive saving and reload', async ({ page }, testInfo) => {
  const { versions } = await backend(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/admin/campaigns')
  const inspector = page.getByRole('complementary', { name: 'Elementide muutmine' })
  await expect(page.getByRole('button', { name: 'Liiguta: Telefon', exact: true })).toBeVisible()
  await expect(inspector.getByRole('checkbox', { name: 'Näita: Logo', exact: true })).not.toBeChecked()
  await expect(inspector.getByRole('checkbox', { name: 'Näita: Pealkiri', exact: true })).not.toBeChecked()
  await expect(page.getByRole('spinbutton', { name: 'Elemendi suurus', exact: true })).toHaveValue('130')
  await expect(page.getByRole('combobox', { name: 'Telefoni liikumine', exact: true })).toHaveValue('zoom')
  await page.getByRole('combobox', { name: 'Telefoni liikumine', exact: true }).selectOption('float')
  await page.getByRole('button', { name: 'Esita', exact: true }).click()
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Videokaader' }).inputValue())).toBeGreaterThan(.3)
  await page.getByRole('button', { name: 'Peata', exact: true }).click()
  await expect(page.getByRole('slider', { name: 'Videokaader' })).toBeEnabled()
  expect(Number(await page.getByRole('slider', { name: 'Videokaader' }).inputValue())).toBeGreaterThan(.3)
  const phone = page.getByRole('button', { name: 'Liiguta: Telefon', exact: true })
  const box = (await phone.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2 - 15, { steps: 5 }); await page.mouse.up()
  const movedX = await page.getByRole('spinbutton', { name: 'Elemendi X', exact: true }).inputValue()
  expect(Number(movedX)).toBeLessThan(540)
  await page.getByRole('button', { name: 'Võta paigutus tagasi', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Elemendi X', exact: true })).toHaveValue('540')
  await page.getByRole('button', { name: 'Taasta paigutuse muudatus', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Elemendi X', exact: true })).toHaveValue(movedX)
  await phone.click()
  await page.keyboard.press('Shift+ArrowRight')
  expect(Number(await page.getByRole('spinbutton', { name: 'Elemendi X', exact: true }).inputValue())).toBe(Number(movedX) + 10)
  const handle = (await page.getByRole('button', { name: 'Muuda suurust: Telefon, all paremal', exact: true }).boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down(); await page.mouse.move(handle.x + 25, handle.y + 30, { steps: 5 }); await page.mouse.up()
  const scale = await page.getByRole('spinbutton', { name: 'Elemendi suurus', exact: true }).inputValue()
  expect(Number(scale)).toBeGreaterThan(130)
  await page.screenshot({ path: testInfo.outputPath('campaign-editor-desktop.png'), fullPage: true })
  await inspector.getByRole('button', { name: 'Pealkiri', exact: true }).click()
  await page.getByRole('textbox', { name: 'Elemendi tekst', exact: true }).fill('')
  await page.getByRole('button', { name: /Lõpp 9–12 s/ }).click()
  await expect(inspector.getByRole('checkbox', { name: 'Näita: Logo', exact: true })).toBeChecked()
  await inspector.getByRole('button', { name: 'Slogan', exact: true }).click()
  await page.getByRole('textbox', { name: 'Elemendi tekst', exact: true }).fill('Oma pood. Oma moodi.')
  await page.getByRole('button', { name: 'Turvaalasse', exact: true }).click()
  await page.getByRole('button', { name: 'Salvesta versioon', exact: true }).click()
  await expect.poll(() => versions.length).toBe(1)
  expect(versions[0].document.copy.headlines[0]).toBe('')
  expect(versions[0].document.endCopy.slogan).toBe('Oma pood. Oma moodi.')
  expect(versions[0].document.layouts.reel.phone.scale).toBeGreaterThan(1.3)
  expect(versions[0].document.phoneMotion).toBe('float')
  await page.getByRole('tab', { name: 'Postitused', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Elemendi suurus', exact: true }).fill('95')
  await page.getByRole('button', { name: 'Postitus 2', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Elemendi suurus', exact: true })).toHaveValue('82')
  await page.getByRole('tab', { name: 'Story’d', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Elemendi suurus', exact: true })).toHaveValue('102')
  await page.reload()
  await expect(page.getByRole('spinbutton', { name: 'Elemendi suurus', exact: true })).toHaveValue(scale)
  await expect(page.getByRole('combobox', { name: 'Telefoni liikumine', exact: true })).toHaveValue('float')
  await page.getByRole('combobox', { name: 'Telefoni liikumine', exact: true }).selectOption('still')
  await page.getByRole('slider', { name: 'Videokaader' }).fill('8')
  await expect(page.getByRole('spinbutton', { name: 'Elemendi suurus', exact: true })).toHaveValue(scale)
  await page.getByRole('tab', { name: 'Postitused', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Elemendi suurus', exact: true })).toHaveValue('95')
  await page.getByRole('tab', { name: 'Reels', exact: true }).click()
  await page.getByRole('button', { name: /Lõpp 9–12 s/ }).click()
  await inspector.getByRole('button', { name: 'Slogan', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Elemendi tekst', exact: true })).toHaveValue('Oma pood. Oma moodi.')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('campaign-editor-mobile.png'), fullPage: true })
})

test('store selection, snapshots and scripted phone actions reach the exported MP4', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(20_000)
  const { versions } = await backend(page)
  const source = 'http://localhost:4174/storage/v1/object/public/product-images/'
  const stores = [
    { id: '20000000-0000-4000-8000-000000000001', name: 'Keraamikakoda', slug: 'keraamikakoda', is_published: true, settings: { storeTheme: 'midnight', storeAccent: '#e5f25a', privateNote: 'not part of a snapshot' }, shipping: [], payment_provider: 'stripe', payment_status: 'connected' },
    { id: '20000000-0000-4000-8000-000000000002', name: 'Teine pood', slug: 'teine-pood', is_published: true, settings: { storeTheme: 'paper', storeAccent: '#ff7755' }, shipping: [], payment_provider: 'stripe', payment_status: 'connected' },
  ]
  let changed = false, imageRequests = 0
  const products = [
    { id: '30000000-0000-4000-8000-000000000001', name: 'Punane kruus', image_url: source + 'red.jpg', gallery: [source + 'red.jpg', source + 'green.jpg'], description: 'Käsitööna valmistatud punane kruus. Sobib igapäevaseks kasutamiseks.', price: 19, stock: 5, search_visible: true, object_position: null, options: null },
    { id: '30000000-0000-4000-8000-000000000002', name: 'Sinine kauss', image_url: source + 'blue.jpg', gallery: [source + 'blue.jpg'], description: 'Suur kauss kodusesse kööki.', price: 25, stock: 3, search_visible: true, object_position: null, options: [] },
  ]
  await page.route(/\/(?:__e2e_supabase|storage)\//, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/storefront_seo_catalog')) return route.fulfill({ json: stores })
    if (url.pathname.endsWith('/public_storefronts')) return route.fulfill({ json: stores.find((s) => 'eq.' + s.slug === url.searchParams.get('slug')) })
    if (url.pathname.endsWith('/products')) return route.fulfill({ json: products.map((p) => ({ ...p, price: changed ? 999 : p.price })) })
    if (url.pathname.includes('/product-images/')) {
      imageRequests++
      const color = changed ? '#000000' : url.pathname.includes('red') ? '#dd3333' : url.pathname.includes('blue') ? '#3355dd' : '#33bb55'
      return route.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: `<svg xmlns="http://www.w3.org/2000/svg" width="780" height="1608"><rect width="780" height="1608" fill="${color}"/><circle cx="390" cy="760" r="180" fill="#ffffff" opacity=".25"/></svg>` })
    }
    return route.fallback()
  })
  await page.goto('/admin/campaigns')
  await page.locator('.campaign-phone > summary').click()
  await expect(page.getByRole('option', { name: 'Teine pood', exact: true })).toBeAttached()
  await page.getByLabel('Pood', { exact: true }).selectOption('teine-pood')
  await expect(page.getByRole('button', { name: 'Rakenda valik · 2/6' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Sinine kauss', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Rakenda valik · 1/6', exact: true }).click()
  await expect(page.getByText(/Poe sisu salvestatud/)).toContainText('1 toodet', { timeout: 20_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.locator('.campaign-phone__picker > summary').click()
  await page.getByLabel('Pood', { exact: true }).selectOption('keraamikakoda')
  await page.getByRole('button', { name: 'Rakenda valik · 2/6' }).click()
  await expect(page.getByText(/Poe sisu salvestatud/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Laadin eelvaadet…')).toHaveCount(0, { timeout: 40_000 })
  await expect(page.getByRole('button', { name: 'Proovi uuesti', exact: true })).toHaveCount(0)
  await page.getByLabel('Tegevuste mall', { exact: true }).selectOption('search')
  await page.getByLabel('Tegevuse 2 toode', { exact: true }).selectOption(products[1].id)
  await page.getByLabel('Tegevuse 2 otsingusõna', { exact: true }).fill('kauss')
  await page.getByLabel('Tegevuse 2 kestus', { exact: true }).fill('6')
  await page.getByLabel('Tegevus 3', { exact: true }).selectOption('gallery')
  await page.getByLabel('Tegevuse 3 toode', { exact: true }).selectOption(products[0].id)
  await page.getByLabel('Tegevuse 3 galeriipilt', { exact: true }).selectOption('1')
  await page.getByRole('button', { name: 'Tegevus 3 üles', exact: true }).click()
  await expect(page.getByLabel('Tegevus 2', { exact: true })).toHaveValue('gallery')
  await page.getByRole('button', { name: '+ Tegevus', exact: true }).click()
  await page.getByLabel('Tegevus 4', { exact: true }).selectOption('scroll')
  await page.getByLabel('Tegevuse 4 toode', { exact: true }).selectOption(products[1].id)
  await expect(page.locator('.campaign-phone__total')).toContainText('12 s + lõpp 3 s')
  await page.getByRole('button', { name: 'Salvesta versioon', exact: true }).click()
  await expect.poll(() => versions.length).toBe(1)
  const saved = versions[0].document
  expect(saved.phoneContent.snapshot.store.name).toBe('Keraamikakoda')
  expect(saved.phoneContent.snapshot.store.settings).not.toHaveProperty('privateNote')
  expect(saved.phoneContent.snapshot.products[0].price).toBe(19)
  expect(Object.values(saved.phoneContent.snapshot.assets).every((src) => String(src).startsWith('data:image/jpeg;base64,'))).toBe(true)
  await page.getByLabel('Tegevuse 3 otsingusõna', { exact: true }).fill('puudub')
  await expect(page.getByText('Mustand selles brauseris', { exact: true })).toBeVisible()
  changed = true
  const previousImageRequests = imageRequests
  await page.reload()
  await page.locator('.campaign-phone > summary').click()
  await expect(page.getByLabel('Tegevuse 3 otsingusõna', { exact: true })).toHaveValue('puudub')
  await page.getByLabel('Tegevuse 3 otsingusõna', { exact: true }).fill('kauss')
  await expect(page.locator('.campaign-editor__safe')).toBeVisible({ timeout: 45_000 })
  await expect(page.getByText('Laadin eelvaadet…')).toHaveCount(0)
  expect(imageRequests).toBe(previousImageRequests)
  await page.screenshot({ path: testInfo.outputPath('phone-content-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Loo failid', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Laadi ZIP' }).or(page.getByRole('alert'))).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Vaata valmis videot' }).click()
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.duration)).toBeCloseTo(15, 0)
  const pixels: number[][] = []
  for (const time of [1, 3.4, 7, 9.5, 11]) {
    pixels.push(await page.locator('video').evaluate(async (v: HTMLVideoElement, t) => {
      await new Promise<void>((resolve) => { v.addEventListener('seeked', () => resolve(), { once: true }); v.currentTime = t })
      const c = document.createElement('canvas'); c.width = c.height = 1
      const ctx = c.getContext('2d')!; ctx.drawImage(v, 535, 930, 10, 10, 0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }, time))
    await page.locator('video').screenshot({ path: testInfo.outputPath(`selected-store-${time}.png`) })
  }
  expect(pixels[0][0] - pixels[0][1]).toBeGreaterThan(80) // selected store red product
  expect(pixels[1][1] - pixels[1][0]).toBeGreaterThan(40) // chosen gallery image
  expect(Math.max(...pixels[2])).toBeLessThan(60) // actual search overlay
  expect(pixels[3][2] - pixels[3][0]).toBeGreaterThan(80) // search result opens blue product
  expect(Math.max(...pixels[4])).toBeLessThan(60) // actual product information after scrolling
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Laadi ZIP' }).click()
  const archive = unzipSync(new Uint8Array(await readFile((await (await downloading).path())!)))
  for (const name of ['reels-helita.mp4', 'reels-heliga.mp4']) {
    const input = new Input({ source: new BlobSource(new Blob([archive[name]])), formats: [MP4] })
    expect(await input.computeDuration()).toBeCloseTo(15, 0)
    if (name.includes('heliga')) expect(await (await input.getPrimaryAudioTrack())!.computeDuration()).toBeCloseTo(15, 1)
    input.dispose()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('phone-content-mobile.png'), fullPage: true })
})
