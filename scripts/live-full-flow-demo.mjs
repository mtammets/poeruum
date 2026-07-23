import crypto from 'node:crypto'
import { config } from 'dotenv'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

config({ path: '.env', quiet: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const stripeKey = process.env.STRIPE_SECRET_KEY
const appUrl = process.env.STRIPE_E2E_APP_URL || 'http://127.0.0.1:5173'
if (!supabaseUrl || !anonKey || !serviceKey || !stripeKey?.startsWith('sk_test_')) {
  throw new Error('Live-test nõuab Supabase’i võtmeid ja Stripe’i testvõtit.')
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
})
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const observe = async (message, milliseconds = 8000) => {
  console.log(`\n[VAATA ADMINIST] ${message}`)
  await wait(milliseconds)
}
const waitFor = async (check, label, attempts = 40, delay = 500) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await check()
    if (value) return value
    await wait(delay)
  }
  throw new Error(`${label} ei jõudnud oodatud olekusse.`)
}
const stripeRequest = async (path, options = {}) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${stripeKey}`, ...options.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error?.message || `Stripe vastas ${response.status}.`)
  return body
}
const getStore = async (userId) => {
  const { data, error } = await admin.from('stores').select('*').eq('owner_id', userId).maybeSingle()
  if (error) throw error
  return data
}
const fillStripeCheckout = async (page) => {
  await page.locator('#cardNumber').fill('4242424242424242')
  await page.locator('#cardExpiry').fill('1234')
  await page.locator('#cardCvc').fill('123')
  await page.locator('#billingName').fill('Poeruum Täisvoo Test')
  const country = page.locator('select[name="billingCountry"]')
  if (await country.count()) await country.selectOption('EE')
  const postalCode = page.locator('input[name="billingPostalCode"]')
  if (await postalCode.count()) await postalCode.fill('10111')
  const stripePass = page.locator('#enableStripePass')
  if (await stripePass.count() && await stripePass.isChecked()) await stripePass.uncheck()
}

const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`
const fixture = {
  email: `acceptance-test-${suffix}@example.com`,
  password: `Poeruum-${crypto.randomUUID()}!`,
  userId: null,
  storeId: null,
  checkoutSessionId: null,
}
let browser

const cleanupOnFailure = async () => {
  const store = fixture.userId ? await getStore(fixture.userId).catch(() => null) : null
  if (store?.stripe_subscription_id) await stripeRequest(`subscriptions/${store.stripe_subscription_id}`, { method: 'DELETE' }).catch(() => null)
  if (fixture.checkoutSessionId) await stripeRequest(`checkout/sessions/${fixture.checkoutSessionId}/expire`, { method: 'POST' }).catch(() => null)
  if (store?.stripe_customer_id) await stripeRequest(`customers/${store.stripe_customer_id}`, { method: 'DELETE' }).catch(() => null)
  if (fixture.storeId) await admin.from('stores').delete().eq('id', fixture.storeId)
  if (fixture.userId) await admin.auth.admin.deleteUser(fixture.userId)
  await browser?.close().catch(() => null)
}

try {
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: fixture.email,
    password: fixture.password,
    email_confirm: true,
    user_metadata: { display_name: 'TÄISVOO REAALAJAS TEST' },
  })
  if (userError) throw userError
  fixture.userId = created.user.id
  console.log(`[TEST] Kasutaja: ${fixture.email}`)
  await observe('Uus „TÄISVOO REAALAJAS TEST” kasutaja peab ilmuma tabeli algusse 0% edenemisega.')

  browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  })
  const context = await browser.newContext({ locale: 'en-US' })
  const page = await context.newPage()
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Logi sisse', exact: true }).first().click()
  await page.getByLabel('E-posti aadress').fill(fixture.email)
  await page.getByLabel('Parool').fill(fixture.password)
  await page.getByRole('button', { name: /Jätka oma poega/ }).click()
  await page.getByRole('heading', { name: 'Mis on sinu poe nimi?' }).waitFor({ timeout: 20_000 })
  await waitFor(async () => {
    const { data, error } = await admin.from('user_presence_sessions').select('session_id').eq('user_id', fixture.userId).limit(1)
    if (error) throw error
    return data?.length ? data[0] : null
  }, 'Kasutaja online-olek')
  await observe('Kasutaja avatari juures peab nüüd olema roheline täpp ja olek „Online”.')

  await page.getByLabel('Poe nimi').fill(`TÄISVOO REAALAJAS TEST ${suffix.slice(-6)}`)
  await page.getByRole('button', { name: /Jätka müüja andmetega/ }).click()
  await page.getByRole('heading', { name: 'Sinu ettevõte' }).waitFor()
  const firstStore = await waitFor(async () => await getStore(fixture.userId), 'Poe loomine')
  fixture.storeId = firstStore.id
  await observe('Edenemine peab liikuma 33%-le: poe nimi ja vaikimisi valitud tarneviisid on salvestatud.')

  await page.getByLabel('Registrikood').fill('12345678')
  await page.getByLabel('Ettevõtte nimi').fill('Poeruum Täisvoo Test OÜ')
  await page.getByLabel('Ettevõtte aadress').fill('Testi 1, 10111 Tallinn, Eesti')
  await page.getByLabel('Klientide kontakt-e-post').fill(fixture.email)
  await page.getByRole('button', { name: /Jätka maksetega/ }).click()
  await page.getByRole('heading', { name: 'Kuidas kliendid maksavad?' }).waitFor()
  await observe('Müüja andmete järel peab edenemine liikuma 50%-le.')

  await page.locator('.provider-list button').filter({ hasText: 'Montonio' }).click()
  await page.getByRole('button', { name: /Seadista Montonio/ }).click()
  const montonio = page.getByRole('dialog', { name: 'Montonio ühendamise demo' })
  await montonio.getByRole('button', { name: /Mul on Montonio konto/ }).click()
  await montonio.getByRole('button', { name: /Ühenda pood/ }).click()
  await montonio.getByRole('heading', { name: 'Montonio maksed on aktiivsed' }).waitFor({ timeout: 10_000 })
  await montonio.getByRole('button', { name: 'Tagasi Poeruumi', exact: true }).click()
  await waitFor(async () => (await getStore(fixture.userId))?.payment_status === 'connected', 'Makseühenduse salvestamine')
  await observe('Makseühendus peab muutma edenemise 67%-le.')

  await page.getByRole('button', { name: /Jätka tarnega/ }).click()
  await page.getByRole('heading', { name: 'Vali tarneviisid' }).waitFor()
  await page.getByRole('button', { name: /Jätka avaldamisega/ }).click()
  await page.getByRole('heading', { name: 'Vali pakett' }).waitFor()

  const productId = `acceptance-test-product-${suffix}`
  const { error: productError } = await admin.from('products').insert({
    id: productId,
    store_id: fixture.storeId,
    name: 'Täisvoo testtoode',
    description: 'Reaalajas vastuvõtutesti toode',
    image_url: 'https://placehold.co/800x1000/png',
    alt: 'Täisvoo testtoode',
    price: 10,
    stock: 1,
    slug: `taisvoo-testtoode-${suffix}`,
  })
  if (productError) throw productError
  await observe('Esimese toote lisandumisel peab edenemine liikuma 83%-le.')

  await page.getByRole('radio', { name: /Kindel/ }).click()
  await page.getByRole('button', { name: /Jätka maksekaardiga/ }).click()
  await page.getByRole('button', { name: 'Jätka Stripe’is', exact: true }).click()
  await page.locator('#cardNumber').waitFor({ state: 'visible', timeout: 30_000 })
  const checkoutText = await page.locator('body').innerText()
  if (!checkoutText.includes('30 days free') || !checkoutText.includes('€35.96')) {
    throw new Error('Stripe Checkoutis puudub oodatud 30-päevane prooviperiood või 35,96 € summa.')
  }
  fixture.checkoutSessionId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)?.split('#')[0] ?? null
  await fillStripeCheckout(page)
  await page.locator('button[type="submit"]').last().click()
  await page.waitForURL((url) => url.origin === new URL(appUrl).origin, { timeout: 60_000 })
  await page.getByText('Kindel pakett ja 30-päevane prooviperiood on aktiveeritud.', { exact: false }).waitFor({ timeout: 30_000 })
  const billedStore = await waitFor(async () => {
    const store = await getStore(fixture.userId)
    return store?.stripe_subscription_id ? store : null
  }, 'Stripe’i tellimuse webhook', 60, 500)
  if (billedStore.pricing_plan !== 'fixed' || billedStore.stripe_subscription_status !== 'trialing' || !billedStore.trial_started_at) {
    throw new Error(`Kindla paketi olek on vale: ${JSON.stringify({ plan: billedStore.pricing_plan, status: billedStore.stripe_subscription_status, trial: billedStore.trial_started_at })}`)
  }
  await observe('Stripe testkaart aktiveeris Kindla paketi 30-päevase prooviperioodi; edenemine jääb avaldamiseni 83%-le.')

  await page.getByRole('button', { name: /Avalda pood/ }).click()
  const publishedStore = await waitFor(async () => {
    const store = await getStore(fixture.userId)
    return store?.is_published ? store : null
  }, 'Poe avaldamine')
  await observe('Pood peab muutuma 100% valmis reaks, terve rida roheliseks; online-märk peab endiselt põlema.', 3000)

  console.log('\n[VALMIS] Täisvoog õnnestus.')
  console.log(JSON.stringify({
    email: fixture.email,
    userId: fixture.userId,
    storeId: fixture.storeId,
    storeSlug: publishedStore.slug,
    pricingPlan: publishedStore.pricing_plan,
    subscriptionStatus: publishedStore.stripe_subscription_status,
    onlineSessionKeptOpen: true,
  }, null, 2))
  console.log('\n[OOTAN] Jätan kasutaja sessiooni avatuks, et online-märk püsiks. Testandmeid veel ei kustutata.')
  await new Promise(() => {})
} catch (error) {
  console.error('\n[TEST EBAÕNNESTUS]', error)
  await cleanupOnFailure()
  process.exitCode = 1
}
