import crypto from 'node:crypto'
import { config } from 'dotenv'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

config({ path: '.env', quiet: true })

const supabaseUrl = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const stripeKey = process.env.STRIPE_SECRET_KEY
const appUrl = process.env.STRIPE_E2E_APP_URL || 'http://127.0.0.1:5173'
if (!supabaseUrl || !anonKey || !serviceKey || !stripeKey?.startsWith('sk_test_')) {
  throw new Error('Stripe Billing E2E test nõuab Supabase’i võtmeid ja Stripe’i testvõtit.')
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
}
const admin = createClient(supabaseUrl, serviceKey, clientOptions)
const stripeRequest = async (path, options = {}) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${stripeKey}`, ...options.headers },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body?.error?.message || `Stripe vastas ${response.status}.`)
  return body
}
const stripePost = (path, values) => {
  const body = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => body.append(key, String(item)))
    else if (value !== undefined && value !== null) body.set(key, String(value))
  })
  return stripeRequest(path, { method: 'POST', body })
}
const invoke = async (name, body, accessToken) => {
  const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${name} vastas ${response.status}: ${result.error || 'tundmatu viga'}`)
  return result
}
const waitFor = async (check, label, attempts = 30, delay = 1000) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
  throw new Error(`${label} ei jõudnud oodatud olekusse.`)
}
const report = (step) => console.log(JSON.stringify({ step }))

const fixtures = []
const stripeObjects = { sessions: new Set(), subscriptions: new Set(), customers: new Set(), clocks: new Set() }
const createFixture = async (label, { trialStarted = false } = {}) => {
  const email = `stripe-e2e-${label}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}@example.com`
  const password = `E2E-${crypto.randomUUID()}!`
  const { data: created, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (userError) throw userError
  const fixture = { userId: created.user.id, email, password, storeId: null, session: null }
  fixtures.push(fixture)
  const { data: store, error: storeError } = await admin.from('stores').insert({
    owner_id: fixture.userId,
    name: `Stripe E2E ${label}`,
    slug: `stripe-e2e-${label}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
    pricing_plan: 'flexible',
    trial_started_at: trialStarted ? new Date().toISOString() : null,
  }).select().single()
  if (storeError) throw storeError
  fixture.storeId = store.id
  const authClient = createClient(supabaseUrl, anonKey, clientOptions)
  const { data: login, error: loginError } = await authClient.auth.signInWithPassword({ email, password })
  if (loginError) throw loginError
  fixture.session = login.session
  return fixture
}

const createCheckout = async (fixture, checkoutRequestId = fixture.checkoutRequestId ??= crypto.randomUUID()) => {
  const result = await invoke('stripe-billing-checkout', { checkoutRequestId, returnUrl: appUrl }, fixture.session.access_token)
  const sessionId = new URL(result.url).pathname.split('/').filter(Boolean).at(-1)?.split('#')[0]
  if (!sessionId) throw new Error('Stripe Checkout Session ID puudub.')
  stripeObjects.sessions.add(sessionId)
  return { url: result.url, sessionId }
}

const setBrowserSession = async (page, fixture) => {
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
  await page.evaluate(({ storageKey, session }) => {
    localStorage.setItem(storageKey, JSON.stringify(session))
  }, { storageKey: `sb-${projectRef}-auth-token`, session: fixture.session })
}

const fillCheckoutCard = async (page, cardNumber) => {
  await page.locator('#cardNumber').fill(cardNumber)
  await page.locator('#cardExpiry').fill('1234')
  await page.locator('#cardCvc').fill('123')
  await page.locator('#billingName').fill('Poeruum E2E Test')
  const country = page.locator('select[name="billingCountry"]')
  if (await country.count()) await country.selectOption('EE')
  const postalCode = page.locator('input[name="billingPostalCode"]')
  if (await postalCode.count()) await postalCode.fill('10111')
  const stripePass = page.locator('#enableStripePass')
  if (await stripePass.count() && await stripePass.isChecked()) await stripePass.uncheck()
}

const openCheckout = async (browser, fixture, checkout) => {
  const context = await browser.newContext({ locale: 'en-US' })
  const page = await context.newPage()
  await setBrowserSession(page, fixture)
  await page.goto(checkout.url, { waitUntil: 'domcontentloaded' })
  await page.locator('#cardNumber').waitFor({ state: 'visible', timeout: 30_000 })
  const text = await page.locator('body').innerText()
  if (!text.includes('30 days free') || !text.includes('€35.96')) {
    throw new Error(`Stripe Checkouti summa või prooviperiood on vale: ${text.slice(0, 900)}`)
  }
  return { context, page }
}

const submitCheckout = async (page) => {
  const submit = page.locator('button[type="submit"]').last()
  await submit.waitFor({ state: 'visible' })
  await submit.click()
}

const completeThreeDS = async (page) => {
  const challengeFrame = await waitFor(
    () => page.frames().find((frame) => frame.url().includes('testmode-acs.stripe.com')),
    '3D Secure’i kinnitusaken', 30, 500,
  )
  const complete = challengeFrame.getByRole('button', { name: /^complete$/i })
  await complete.waitFor({ state: 'visible', timeout: 15_000 })
  const completeHtml = await complete.evaluate((element) => element.outerHTML)
  await Promise.all([
    challengeFrame.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => null),
    complete.press('Enter'),
  ])
  try {
    await waitFor(() => !page.frames().some((frame) => frame.url().includes('testmode-acs.stripe.com')), '3D Secure’i akna sulgumine', 30, 500)
  } catch (error) {
    const formHtml = await challengeFrame.locator('form').first().evaluate((element) => element.outerHTML).catch(() => '')
    throw new Error(`3D Secure’i aken ei sulgunud. BUTTON=${completeHtml} FORM=${formHtml.slice(0, 1200)} BODY=${(await challengeFrame.locator('body').innerText().catch(() => '')).slice(0, 600)}`, { cause: error })
  }
}

const waitForBillingReturn = async (page, expectedText) => {
  try {
    await page.waitForURL((url) => url.origin === new URL(appUrl).origin, { timeout: 60_000 })
  } catch (error) {
    const frames = []
    for (const frame of page.frames()) frames.push({ url: frame.url(), text: (await frame.locator('body').innerText().catch(() => '')).slice(0, 1200) })
    throw new Error(`Billing ei suunanud rakendusse tagasi. URL=${page.url()} FRAMES=${JSON.stringify(frames)}`, { cause: error })
  }
  try {
    await page.getByText(expectedText, { exact: false }).waitFor({ timeout: 30_000 })
  } catch (error) {
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 1800)
    throw new Error(`Billingu kinnitust ei kuvatud. URL=${page.url()} BODY=${body}`, { cause: error })
  }
  await waitFor(() => !new URL(page.url()).searchParams.has('billing'), 'Billingu URL-i puhastamine', 20, 250)
}

const recordCheckoutObjects = async (sessionId) => {
  const session = await stripeRequest(`checkout/sessions/${sessionId}`)
  if (typeof session.subscription === 'string') stripeObjects.subscriptions.add(session.subscription)
  if (typeof session.customer === 'string') stripeObjects.customers.add(session.customer)
  return session
}

const assertRealCheckoutWebhook = async (sessionId) => {
  const event = await waitFor(async () => {
    const events = await stripeRequest('events?type=checkout.session.completed&limit=20')
    return events.data.find((candidate) => candidate.data?.object?.id === sessionId)
  }, 'Stripe checkout.session.completed sündmus')
  await waitFor(async () => {
    const { data, error } = await admin.from('stripe_webhook_events').select('processed_at').eq('event_id', event.id).maybeSingle()
    if (error) throw error
    return Boolean(data?.processed_at)
  }, 'Supabase’i töödeldud checkout webhook')
  return event
}

const cleanup = async () => {
  for (const fixture of fixtures) {
    if (!fixture.storeId) continue
    const { data: store } = await admin.from('stores')
      .select('stripe_subscription_id,stripe_customer_id')
      .eq('id', fixture.storeId)
      .maybeSingle()
    if (store?.stripe_subscription_id) stripeObjects.subscriptions.add(store.stripe_subscription_id)
    if (store?.stripe_customer_id) stripeObjects.customers.add(store.stripe_customer_id)
  }
  for (const subscriptionId of stripeObjects.subscriptions) {
    await stripeRequest(`subscriptions/${subscriptionId}`, { method: 'DELETE' }).catch(() => null)
  }
  for (const sessionId of stripeObjects.sessions) {
    await stripeRequest(`checkout/sessions/${sessionId}/expire`, { method: 'POST' }).catch(() => null)
  }
  for (const clockId of stripeObjects.clocks) {
    await stripeRequest(`test_helpers/test_clocks/${clockId}`, { method: 'DELETE' }).catch(() => null)
  }
  for (const customerId of stripeObjects.customers) {
    await stripeRequest(`customers/${customerId}`, { method: 'DELETE' }).catch(() => null)
  }
  for (const fixture of fixtures.reverse()) {
    if (fixture.storeId) await admin.from('stores').delete().eq('id', fixture.storeId)
    await admin.auth.admin.deleteUser(fixture.userId)
  }
}

const main = async () => {
  const scenario = process.env.STRIPE_E2E_SCENARIO || 'all'
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  try {
    if (scenario !== '3ds') {
    const successFixture = await createFixture('success')
    report('success fixture created')
    const successCheckout = await createCheckout(successFixture)
    const repeatedCheckout = await createCheckout(successFixture)
    if (repeatedCheckout.sessionId !== successCheckout.sessionId) throw new Error('Billingu topeltpäring lõi kaks Checkout Sessionit.')
    const successBrowser = await openCheckout(browser, successFixture, successCheckout)
    await fillCheckoutCard(successBrowser.page, '4242424242424242')
    await submitCheckout(successBrowser.page)
    await waitForBillingReturn(successBrowser.page, 'Kindel pakett ja 30-päevane prooviperiood on aktiveeritud')
    report('success card returned to app')
    const successStore = await waitFor(async () => {
      const { data, error } = await admin.from('stores').select('*').eq('id', successFixture.storeId).single()
      if (error) throw error
      return data.stripe_subscription_id ? data : null
    }, 'Poeruumi aktiveeritud pakett')
    if (successStore.pricing_plan !== 'fixed' || successStore.stripe_subscription_status !== 'trialing'
      || successStore.stripe_billing_mode !== 'test' || !successStore.trial_started_at) {
      throw new Error(`Eduka Checkouti järel on poe olek vale: ${JSON.stringify({ pricingPlan: successStore.pricing_plan, subscriptionStatus: successStore.stripe_subscription_status, billingMode: successStore.stripe_billing_mode, trialStarted: Boolean(successStore.trial_started_at) })}`)
    }
    const successSession = await recordCheckoutObjects(successCheckout.sessionId)
    if (successSession.status !== 'complete' || successSession.amount_total !== 0) {
      throw new Error(`Stripe ei lõpetanud tasuta prooviperioodi Checkout Sessionit korrektselt: ${JSON.stringify({ status: successSession.status, paymentStatus: successSession.payment_status, amountTotal: successSession.amount_total })}`)
    }
    const successSubscription = await stripeRequest(`subscriptions/${successStore.stripe_subscription_id}`)
    stripeObjects.subscriptions.add(successSubscription.id)
    if (successSubscription.status !== 'trialing' || !successSubscription.trial_end) throw new Error('Stripe’i subscription ei ole trialing olekus.')
    const trialDays = (successSubscription.trial_end - successSubscription.trial_start) / 86400
    if (Math.abs(trialDays - 30) > 0.01) throw new Error(`Stripe’i prooviperiood on ${trialDays}, mitte 30 päeva.`)
    await assertRealCheckoutWebhook(successCheckout.sessionId)
    report('success webhook processed')
    const cancellation = await invoke('stripe-billing-cancel', {}, successFixture.session.access_token)
    if (cancellation.effectiveImmediately !== false) throw new Error('Aktiivse paketi tühistamine rakendus valel ajal.')
    const cancelledSubscription = await stripeRequest(`subscriptions/${successSubscription.id}`)
    if (!cancelledSubscription.cancel_at_period_end) throw new Error('Paketi tühistamine ei seadnud cancel_at_period_end väärtust.')
    report('subscription cancellation scheduled')
    await successBrowser.context.close()
    }

    const threeDSFixture = await createFixture('3ds')
    report('3ds fixture created')
    const threeDSCheckout = await createCheckout(threeDSFixture)
    const threeDSBrowser = await openCheckout(browser, threeDSFixture, threeDSCheckout)
    await fillCheckoutCard(threeDSBrowser.page, '4000002500003155')
    await submitCheckout(threeDSBrowser.page)
    report('3ds card submitted')
    await completeThreeDS(threeDSBrowser.page)
    report('3ds challenge completed')
    await waitForBillingReturn(threeDSBrowser.page, 'Kindel pakett ja 30-päevane prooviperiood on aktiveeritud')
    const threeDSStore = await waitFor(async () => {
      const { data } = await admin.from('stores').select('*').eq('id', threeDSFixture.storeId).single()
      return data?.stripe_subscription_id ? data : null
    }, '3D Secure’i paketi aktiveerimine')
    const threeDSSession = await recordCheckoutObjects(threeDSCheckout.sessionId)
    stripeObjects.subscriptions.add(threeDSStore.stripe_subscription_id)
    if (threeDSSession.status !== 'complete' || threeDSStore.stripe_subscription_status !== 'trialing') throw new Error('3D Secure’i Checkout ei aktiveerinud paketti.')
    await assertRealCheckoutWebhook(threeDSCheckout.sessionId)
    report('3ds webhook processed')
    await threeDSBrowser.context.close()

    if (scenario !== '3ds') {
    const declineFixture = await createFixture('decline')
    report('decline fixture created')
    const declineCheckout = await createCheckout(declineFixture)
    const declineBrowser = await openCheckout(browser, declineFixture, declineCheckout)
    await fillCheckoutCard(declineBrowser.page, '4000000000000002')
    await submitCheckout(declineBrowser.page)
    await declineBrowser.page.getByText(/declined|card was declined|your card has been declined/i).first().waitFor({ timeout: 30_000 })
    report('declined card rejected')
    const declinedStore = await admin.from('stores').select('stripe_subscription_id,pricing_plan').eq('id', declineFixture.storeId).single()
    if (declinedStore.data?.stripe_subscription_id || declinedStore.data?.pricing_plan !== 'flexible') throw new Error('Tagasilükatud kaart aktiveeris ekslikult paketi.')
    const declinedSession = await stripeRequest(`checkout/sessions/${declineCheckout.sessionId}`)
    if (declinedSession.status !== 'open') throw new Error('Tagasilükatud kaardi Checkout ei jäänud parandamiseks avatuks.')
    await declineBrowser.page.getByRole('link', { name: /back/i }).first().click()
    await waitForBillingReturn(declineBrowser.page, 'Kindla paketi aktiveerimine katkestati')
    await declineBrowser.context.close()
    }

    console.log(JSON.stringify(scenario === '3ds' ? {
      threeDS: 'authenticated and activated',
      realCheckoutWebhook: 'processed',
    } : {
      successfulCard: 'passed',
      browserReturnAndNotice: 'passed',
      realCheckoutWebhook: 'processed',
      trial: '30 days / trialing',
      duplicateClick: 'one Checkout Session',
      cancellation: 'cancel_at_period_end',
      threeDS: 'authenticated and activated',
      declinedCard: 'rejected without activating plan',
      cancelledCheckoutReturn: 'passed',
    }, null, 2))
  } finally {
    await browser.close()
  }
}

try {
  await main()
} finally {
  await cleanup()
}
