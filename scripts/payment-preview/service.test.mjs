import { describe, expect, it, vi } from 'vitest'
import { createPreviewService, testConfiguration } from './service.mjs'
import { isAllowedPreviewRequest } from './plugin.mjs'
import * as prefill from '../../supabase/functions/_shared/stripe-connect-prefill.ts'
import * as components from '../../supabase/functions/_shared/stripe-connect-session.ts'
import * as requirements from '../../supabase/functions/_shared/stripe-connect-requirements.ts'
import * as hosted from '../../supabase/functions/_shared/stripe-hosted.ts'
import * as oauth from '../../supabase/functions/_shared/stripe-oauth.ts'
import * as sellers from '../../shared/seller.ts'

const environment = { STRIPE_TEST_PUBLISHABLE_KEY: 'pk_test_preview', STRIPE_TEST_SECRET_KEY: 'sk_test_preview' }
const helpers = { ...prefill, ...components, ...requirements, ...sellers, ...oauth, ...hosted }
const make = (extra = {}) => createPreviewService({ origin: 'http://127.0.0.1:4185', environment, helpers, ...extra })
const response = (data, status = 200) => new Response(JSON.stringify(data), { status })

describe('isolated payment preview', () => {
  it('never falls back to live credentials or accepts a mixed key pair', () => {
    for (const values of [
      { STRIPE_SECRET_KEY: 'sk_live_secret', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_live_public' },
      { ...environment, STRIPE_TEST_SECRET_KEY: 'sk_live_secret' },
      { ...environment, STRIPE_TEST_PUBLISHABLE_KEY: 'pk_live_public' },
      { STRIPE_TEST_SECRET_KEY: 'sk_test_only' },
    ]) expect(testConfiguration(values)).toEqual({ ready: false, secretKey: '', publishableKey: '' })
    expect(make().configuration).toEqual({ ready: true, publishableKey: 'pk_test_preview' })
  })

  it('works without any external service for app states and isolates changes between attempts', async () => {
    const fetchStripe = vi.fn()
    const service = make({ environment: {}, fetchStripe })
    const one = service.createSession({ paymentState: 'reviewing' })
    const two = service.createSession({ screen: 'publish', paymentState: 'connected' })
    one.store.settings.businessName = 'Muudetud'
    expect(two.store.settings.businessName).not.toBe('Muudetud')
    expect(two.products).toHaveLength(1)
    expect(await service.stripeAction(one, 'status')).toMatchObject({ status: 'pending', detailsSubmitted: true, requirements: { pendingVerification: true, dueCount: 0 } })
    expect(service.fromAuthorization(`Bearer ${service.authSession(one).access_token}`)).toBe(one)
    expect(() => service.getSession('other-account')).toThrow()
    expect(() => service.fromAuthorization('Bearer external-token')).toThrow()
    await expect(service.stripeAction(one, 'start')).rejects.toThrow('testvõtmed')
    expect(fetchStripe).not.toHaveBeenCalled()
  })

  it('uses production account options and coalesces concurrent account creation', async () => {
    const calls = []
    const fetchStripe = vi.fn(async (url, options) => {
      calls.push({ path: url.replace('https://api.stripe.com/v1/', ''), ...options })
      if (url.endsWith('/accounts')) return response({ id: 'acct_created_here' })
      if (url.endsWith('/account_sessions')) return response({ client_secret: 'test_session_secret' })
      return response({ id: 'acct_created_here', details_submitted: false, charges_enabled: false, payouts_enabled: false, requirements: { currently_due: ['company.address'] } })
    })
    const service = make({ fetchStripe })
    const fixture = service.createSession({ kind: 'stripe', preset: 'new' })
    await Promise.all([service.stripeAction(fixture, 'start'), service.stripeAction(fixture, 'status')])
    const creates = calls.filter((call) => call.path === 'accounts')
    expect(creates).toHaveLength(1)
    expect(creates[0].headers.Authorization).toBe('Bearer sk_test_preview')
    expect(creates[0].headers['Idempotency-Key']).toBeTruthy()
    const payload = creates[0].body
    expect(payload.get('country')).toBe('EE')
    expect(payload.get('business_type')).toBe('company')
    expect(payload.get('controller[stripe_dashboard][type]')).toBe('none')
    expect(payload.get('company[registration_number]')).toBe(fixture.store.settings.registryCode)
    expect(payload.has('company[address][line1]')).toBe(false)
    const accountSession = calls.find((call) => call.path === 'account_sessions').body
    expect(accountSession.get('account')).toBe('acct_created_here')
    expect(accountSession.get('components[account_onboarding][features][disable_stripe_user_authentication]')).toBe('true')
    expect(JSON.stringify(service.configuration)).not.toContain('sk_test_')
    expect(await service.cleanup()).toEqual({ failed: 0, remaining: [] })
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual(['accounts/acct_created_here'])
  })

  it('does not expose provider error bodies and never cleans up a simulated account', async () => {
    const fetchStripe = vi.fn(async () => response({ error: { message: 'sensitive provider payload sk_test_preview' } }, 401))
    const service = make({ fetchStripe })
    const fixture = service.createSession({ paymentState: 'connected' })
    await expect(service.stripeAction(fixture, 'start')).rejects.toThrow('HTTP 401')
    await expect(service.stripeAction(fixture, 'start')).rejects.not.toThrow('sk_test_preview')
    expect(await service.cleanup()).toEqual({ failed: 0, remaining: [] })
    expect(fetchStripe.mock.calls.every(([, options]) => options.method !== 'DELETE')).toBe(true)
  })

  it('takes seller onboarding through Stripe and trusts only its charges and payouts status', async () => {
    let ready = false
    const calls = []
    const fetchStripe = vi.fn(async (url, options) => {
      calls.push({ url, ...options })
      if (url.endsWith('/accounts')) return response({ id: 'acct_seller_created_here' })
      if (url.endsWith('/account_sessions')) return response({ client_secret: 'stripe_test_session' })
      return response({ id: 'acct_seller_created_here', details_submitted: ready, charges_enabled: ready,
        payouts_enabled: ready, capabilities: { transfers: ready ? 'active' : 'inactive' }, requirements: { currently_due: ready ? [] : ['individual.dob.day', 'individual.address.line1', 'external_account'] } })
    })
    const service = make({ fetchStripe })
    const fixture = service.createSession({ kind: 'app', sellerPreview: true, sellerType: 'entrepreneur' })
    fixture.store.settings.sellerFirstName = 'Kadi'
    expect(await service.stripeAction(fixture, 'status')).toMatchObject({ status: 'idle', chargesEnabled: false, payoutsEnabled: false })
    expect(fetchStripe).not.toHaveBeenCalled()
    expect(await service.stripeAction(fixture, 'start')).toEqual({ clientSecret: 'stripe_test_session' })
    const create = calls.find((call) => call.url.endsWith('/accounts')).body
    expect(create.get('business_type')).toBe('individual')
    expect(create.get('individual[first_name]')).toBe('Kadi')
    for (const field of ['company[registration_number]', 'individual[dob][year]', 'individual[id_number]', 'external_account', 'tos_acceptance[date]']) expect(create.has(field)).toBe(false)
    const components = calls.find((call) => call.url.endsWith('/account_sessions')).body
    expect(components.get('components[account_onboarding][features][external_account_collection]')).toBe('true')
    expect(await service.stripeAction(fixture, 'status')).toMatchObject({ status: 'pending', chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, requirements: { dueCount: 3 } })
    expect(fixture.store.payment_status).toBe('pending')
    ready = true
    expect(await service.stripeAction(fixture, 'status')).toMatchObject({ status: 'connected', chargesEnabled: true, payoutsEnabled: true })
    expect(fixture.store.payment_status).toBe('connected')
    await service.cleanup()
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual(['https://api.stripe.com/v1/accounts/acct_seller_created_here'])
  })

  it('cannot activate seller payments with missing test credentials or a preset', async () => {
    const fetchStripe = vi.fn()
    const service = make({ environment: {}, fetchStripe })
    expect(() => service.createSession({ sellerPreview: true, paymentState: 'connected' })).toThrow('seadistamata')
    const fixture = service.createSession({ sellerPreview: true, sellerType: 'entrepreneur' })
    await expect(service.stripeAction(fixture, 'start')).rejects.toThrow('testvõtmed')
    expect(fixture.accountId).toBeNull()
    expect(fixture.store.payment_status).toBe('idle')
    expect(fetchStripe).not.toHaveBeenCalled()
  })

  it('keeps the preview available only to the same local origin', () => {
    const origin = 'http://127.0.0.1:4185'
    expect(isAllowedPreviewRequest({ headers: { host: '127.0.0.1:4185', origin } }, origin)).toBe(true)
    expect(isAllowedPreviewRequest({ headers: { host: '127.0.0.1:4185' } }, origin)).toBe(true)
    for (const headers of [
      { host: '127.0.0.1:4185', origin: 'https://example.com' },
      { host: 'example.com:4185' },
      { host: '127.0.0.1:4185', 'sec-fetch-site': 'cross-site' },
    ]) expect(isAllowedPreviewRequest({ headers }, origin)).toBe(false)
  })
})

describe('dedicated hosted account preview', () => {
  const prepare = () => {
    let account
    const fetchStripe = vi.fn(async (url, options) => {
      if (options.method === 'DELETE') return response({ deleted: true })
      if (url.endsWith('/accounts')) {
        const body = options.body
        account = { id: 'acct_dedicated', country: 'EE', business_type: body.get('business_type'),
          controller: { requirement_collection: body.get('controller[requirement_collection]'), stripe_dashboard: { type: body.get('controller[stripe_dashboard][type]') } },
          metadata: { poeruum_connection: body.get('metadata[poeruum_connection]'), poeruum_store_id: body.get('metadata[poeruum_store_id]') },
          charges_enabled: false, payouts_enabled: false, capabilities: { transfers: 'inactive' }, details_submitted: false,
          requirements: { currently_due: ['external_account'] } }
        return response(account)
      }
      if (url.endsWith('/account_links')) return response({ url: 'https://connect.stripe.com/setup/test' })
      if (url.endsWith('/login_links')) return response({ url: 'https://connect.stripe.com/express/test' })
      return response(account)
    })
    const service = make({ fetchStripe })
    const session = service.createSession({ sellerPreview: true, sellerType: 'entrepreneur' })
    return { service, session, fetchStripe, account: () => account }
  }
  it('creates one dedicated account for repeated starts and expired-link refreshes', async () => {
    const { service, session, fetchStripe, account } = prepare()
    const input = { storeId: session.store.id, returnOrigin: 'http://127.0.0.1:4185' }
    await Promise.all([service.stripeAction(session, 'hosted-start', 'onboarding', input), service.stripeAction(session, 'hosted-start', 'onboarding', input)])
    await service.stripeAction(session, 'hosted-refresh', 'onboarding', input)
    expect(fetchStripe.mock.calls.filter(([url]) => url.endsWith('/accounts'))).toHaveLength(1)
    const payload = fetchStripe.mock.calls.find(([url]) => url.endsWith('/accounts'))[1].body
    expect(payload.get('controller[requirement_collection]')).toBe('stripe')
    expect(payload.get('controller[stripe_dashboard][type]')).toBe('express')
    expect(payload.has('individual[first_name]')).toBe(false)
    expect(payload.has('external_account')).toBe(false)
    const link = fetchStripe.mock.calls.find(([url]) => url.endsWith('/account_links'))[1].body
    expect(link.get('return_url')).toBe('http://127.0.0.1:4185/stripe/connect/return')
    expect(link.get('refresh_url')).toBe('http://127.0.0.1:4185/stripe/connect/return?refresh=1')
    expect(session.store.stripe_connection_type).toBe('hosted')
    expect(await service.stripeAction(session, 'status')).toMatchObject({ status: 'pending', detailsSubmitted: false })
    Object.assign(account(), { individual: { first_name: session.store.settings.sellerFirstName, last_name: session.store.settings.sellerLastName }, charges_enabled: true, payouts_enabled: true, capabilities: { transfers: 'active' }, details_submitted: true, requirements: {} })
    expect(await service.stripeAction(session, 'status')).toMatchObject({ status: 'connected' })
    account().business_type = 'company'
    expect(await service.stripeAction(session, 'status')).toMatchObject({ status: 'pending', setupError: expect.stringContaining('eraisiku') })
    await service.cleanup()
    expect(fetchStripe.mock.calls.filter(([, options]) => options.method === 'DELETE')).toHaveLength(1)
  })
  it('rejects old OAuth, foreign redirects and missing accounts without creating anything', async () => {
    const { service, session, fetchStripe } = prepare()
    for (const action of ['oauth-start', 'oauth-complete', 'hosted-refresh']) await expect(service.stripeAction(session, action)).rejects.toThrow()
    await expect(service.stripeAction(session, 'hosted-start', 'onboarding', { returnOrigin: 'https://evil.example' })).rejects.toThrow()
    await expect(service.stripeAction(session, 'hosted-start', 'onboarding', { storeId: 'other-store' })).rejects.toThrow()
    expect(fetchStripe).not.toHaveBeenCalled()
  })
})
