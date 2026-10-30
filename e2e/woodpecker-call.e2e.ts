import { expect, test, type Page } from '@playwright/test'

test.use({ baseURL: 'http://poeruum.localhost:4174' })

async function openBird(page: Page, homepage = false) {
  await page.route('**/__e2e_supabase/**', route => {
    const path = new URL(route.request().url()).pathname
    let json: unknown = []
    if (path.endsWith('/rpc/get_directory_campaign')) json = { mode: 'on', revision: 1, startsAt: null, endsAt: null, serverNow: new Date().toISOString() }
    if (path.endsWith('/public_storefronts')) json = {
      id: '10000000-0000-4000-8000-000000000001', name: 'Krük-Krük', slug: 'kruk-kruk', is_published: true,
      payment_provider: 'stripe', payment_status: 'connected', settings: { contactEmail: 'hello@example.invalid' },
    }
    return route.fulfill({ json })
  })
  await page.goto(homepage ? '/p/kruk-kruk/koduleht/' : 'http://kaubamaja.poeruum.localhost:4174/?theme=black-friday')
  const button = page.getByRole('button', { name: 'Pane rähn häälitsema', exact: true })
  await expect(button).toBeVisible()
  // Freeze flight for reliable pointer targeting; beak playback remains active.
  await page.addStyleTag({ content: '.company-hero__image, .black-friday-banner__arrival { animation: none !important; translate: none !important; rotate: none !important; scale: 1 !important; }' })
  const root = page.locator(homepage ? '.company-hero' : '.black-friday-banner')
  return { root, button, sound: root.locator('audio'), beak: root.locator('.woodpecker-beak') }
}

type Sample = { time: number; angle: number }

async function recordBeak(page: Page) {
  await page.evaluate(() => {
    const state = window as typeof window & { beakSamples: { time: number; angle: number }[] }
    const sound = document.querySelector('audio')!
    const beak = document.querySelector('.woodpecker-beak')!
    sound.addEventListener('playing', () => {
      state.beakSamples = []
      const sample = () => {
        const angle = Number(beak.getAttribute('transform')?.match(/rotate\(([-.\d]+)/)?.[1] || 0)
        state.beakSamples.push({ time: sound.currentTime, angle })
        if (!sound.paused && !sound.ended) requestAnimationFrame(sample)
      }
      sample()
    })
  })
}

const samples = (page: Page) => page.evaluate(() => (window as typeof window & { beakSamples: Sample[] }).beakSamples)

for (const homepage of [false, true]) {
  test(`${homepage ? 'homepage' : 'campaign'} alternates the supplied recordings and follows their sound and silence`, async ({ page }) => {
    const { button, sound, beak } = await openBird(page, homepage)
    await expect(sound).toHaveJSProperty('paused', true)
    await recordBeak(page)
    await button.click()
    await expect(sound).toHaveJSProperty('paused', false)
    await expect(sound).toHaveAttribute('src', '/audio/campaigns/musta-rahni-call-1.mp3')
    // A second press during the same call must not layer or restart recordings.
    await button.press('Enter')
    await expect(sound).toHaveAttribute('src', '/audio/campaigns/musta-rahni-call-1.mp3')
    await expect.poll(() => sound.evaluate(audio => audio.ended)).toBe(true)
    const first = await samples(page)
    expect(first.some(sample => sample.time > .075 && sample.time < .3 && sample.angle < -5)).toBe(true)
    expect(first.some(sample => sample.time > .9 && Math.abs(sample.angle) < .5)).toBe(true)
    await expect(beak).toHaveAttribute('transform', 'rotate(0.00 265 490)')

    await button.press('Enter')
    await expect(sound).toHaveAttribute('src', '/audio/campaigns/musta-rahni-call-2.mp3')
    await expect(sound).toHaveJSProperty('paused', false)
    await expect.poll(() => sound.evaluate(audio => audio.ended)).toBe(true)
    const second = await samples(page)
    expect(second.some(sample => sample.time > .7 && sample.time < 1.4 && sample.angle < -5)).toBe(true)
    // Recording two has a long quiet tail: the beak must close before playback ends.
    const tail = second.filter(sample => sample.time > 2.3 && sample.time < 2.7)
    expect(tail.length).toBeGreaterThan(2)
    expect(tail.every(sample => Math.abs(sample.angle) < .1)).toBe(true)
    await expect(beak).toHaveAttribute('transform', 'rotate(0.00 265 490)')
    await button.press('Enter')
    await expect(sound).toHaveAttribute('src', '/audio/campaigns/musta-rahni-call-1.mp3')
  })
}

test('reduced motion keeps the beak still, and hiding the page stops the sound', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { button, sound, beak } = await openBird(page, true)
  await button.press('Enter')
  await expect(sound).toHaveJSProperty('paused', false)
  await expect.poll(() => sound.evaluate(audio => audio.currentTime)).toBeGreaterThan(.2)
  await expect(beak).toHaveAttribute('transform', 'rotate(0.00 265 490)')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(sound).toHaveJSProperty('paused', true)
  await expect(button).not.toHaveAttribute('aria-busy', 'true')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(sound).toHaveJSProperty('paused', true)
})

test('a failed audio request can be retried without skipping a recording', async ({ page }) => {
  const audioUrl = '**/audio/campaigns/musta-rahni-call-1.mp3'
  await page.route(audioUrl, route => route.abort())
  const { button, sound, beak } = await openBird(page, true)
  await button.press('Enter')
  await expect.poll(() => sound.evaluate(audio => audio.error !== null)).toBe(true)
  await expect(button).not.toHaveAttribute('aria-busy', 'true')
  await expect(beak).toHaveAttribute('transform', 'rotate(0.00 265 490)')
  await page.unroute(audioUrl)
  await button.press('Enter')
  await expect(sound).toHaveAttribute('src', '/audio/campaigns/musta-rahni-call-1.mp3')
  await expect(sound).toHaveJSProperty('paused', false)
  await expect.poll(() => sound.evaluate(audio => audio.currentTime)).toBeGreaterThan(.1)
})
