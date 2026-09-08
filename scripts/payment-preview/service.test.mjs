import { describe, expect, it, vi } from 'vitest'
import { createPreviewService, testConfiguration } from './service.mjs'
import { isAllowedPreviewRequest } from './plugin.mjs'
import * as prefill from '../../supabase/functions/_shared/stripe-connect-prefill.ts'
import * as components from '../../supabase/functions/_shared/stripe-connect-session.ts'
import * as requirements from '../../supabase/functions/_shared/stripe-connect-requirements.ts'

const environment = { STRIPE_TEST_PUBLISHABLE_KEY: 'pk_test_preview', STRIPE_TEST_SECRET_KEY: 'sk_test_preview' }
const helpers = { ...prefill, ...components, ...requirements }
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
