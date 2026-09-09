import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const stripeMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  onboarding: vi.fn(),
  management: vi.fn(),
  notificationBanner: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('@stripe/connect-js', () => ({
  loadConnectAndInitialize: stripeMocks.initialize,
}))

vi.mock('@stripe/react-connect-js', async () => {
  const { createElement: createMockElement } = await import('react')
  return {
    ConnectComponentsProvider: ({ children }: { children: ReactNode }) =>
      createMockElement('div', { 'data-stripe-component': 'provider' }, children),
    ConnectAccountOnboarding: (props: Record<string, unknown>) => {
      stripeMocks.onboarding(props)
      return createMockElement('div', { 'data-stripe-component': 'onboarding' })
    },
    ConnectAccountManagement: (props: Record<string, unknown>) => {
      stripeMocks.management(props)
      return createMockElement('div', { 'data-stripe-component': 'management' })
    },
    ConnectNotificationBanner: (props: Record<string, unknown>) => {
      stripeMocks.notificationBanner(props)
      return createMockElement('div', { 'data-stripe-component': 'notification-banner' })
    },
  }
})

vi.mock('./lib/database', () => ({
  invokeStripeConnect: stripeMocks.invoke,
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.unstubAllEnvs()
})

describe('Stripe remediation form', () => {
  it('uses an injected preview connection without calling the production backend', async () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_live_not_used_by_preview')
    stripeMocks.initialize.mockReturnValue({ testConnectInstance: true })
    const { default: StripeEmbeddedOnboarding } = await import('./StripeEmbeddedOnboarding')
    const fetchClientSecret = vi.fn().mockResolvedValue('preview_session_secret')
    const onStepChange = vi.fn()
    const html = renderToStaticMarkup(createElement(StripeEmbeddedOnboarding, {
      connection: { publishableKey: 'pk_test_preview', fetchClientSecret }, onStepChange,
      onExit: async () => undefined, onClose: async () => undefined, onError: () => undefined,
    }))
    expect(html).toContain('Testkeskkond')
    const options = stripeMocks.initialize.mock.calls[0][0]
    expect(options.publishableKey).toBe('pk_test_preview')
    await expect(options.fetchClientSecret()).resolves.toBe('preview_session_secret')
    expect(fetchClientSecret).toHaveBeenCalledWith('onboarding')
    expect(stripeMocks.invoke).not.toHaveBeenCalled()
    stripeMocks.onboarding.mock.calls[0][0].onStepChange({ step: 'business_details' })
    expect(onStepChange).toHaveBeenCalledWith('business_details')
  })

  it('renders one focused form without broad account management or a notification banner', async () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_remediation')
    stripeMocks.initialize.mockReturnValue({ testConnectInstance: true })
    stripeMocks.invoke.mockResolvedValue({ clientSecret: 'acct_session_secret' })
    const { default: StripeEmbeddedOnboarding } = await import('./StripeEmbeddedOnboarding')

    const html = renderToStaticMarkup(createElement(StripeEmbeddedOnboarding, {
      mode: 'remediation',
      onExit: async () => undefined,
      onClose: async () => undefined,
      onError: () => undefined,
    }))

    expect(html).toContain('aria-label="Ettevõtte andmete kinnitamine"')
    expect(html).not.toContain('Stripe’i eraldi sisselogimisakent')
    expect(html).toContain('data-stripe-component="onboarding"')
    expect(html).not.toContain('data-stripe-component="management"')
    expect(html).not.toContain('data-stripe-component="notification-banner"')
    expect(stripeMocks.onboarding).toHaveBeenCalledOnce()
    expect(stripeMocks.onboarding).toHaveBeenCalledWith(expect.objectContaining({
      collectionOptions: {
        fields: 'currently_due',
        futureRequirements: 'include',
      },
    }))
    expect(stripeMocks.management).not.toHaveBeenCalled()
    expect(stripeMocks.notificationBanner).not.toHaveBeenCalled()

    const initializeOptions = stripeMocks.initialize.mock.calls[0]?.[0] as {
      fetchClientSecret: () => Promise<string>
    }
    await expect(initializeOptions.fetchClientSecret()).resolves.toBe('acct_session_secret')
    expect(stripeMocks.invoke).toHaveBeenCalledWith('start', 'remediation')
  })

  it('offers address editing for a rejected document and uses a management session for editing', async () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_remediation')
    stripeMocks.initialize.mockReturnValue({ testConnectInstance: true })
    stripeMocks.invoke.mockResolvedValue({ clientSecret: 'management_session_secret' })
    const { default: StripeEmbeddedOnboarding } = await import('./StripeEmbeddedOnboarding')
    const onManage = vi.fn()
    const props = {
      requirements: {
        dueCount: 1, pastDue: true, currentDeadline: null,
        pendingVerification: false, disabledReason: 'requirements.past_due',
        issues: [{ code: 'verification_document_address_mismatch', requirement: 'company.verification.document' }],
      },
      onManage,
      onExit: async () => undefined,
      onClose: async () => undefined,
      onError: () => undefined,
    }
    const html = renderToStaticMarkup(createElement(StripeEmbeddedOnboarding, { ...props, mode: 'remediation' }))
    expect(html).toContain('Dokumendil olev aadress ei ühti ettevõtte aadressiga')
    expect(html).toContain('Muuda andmeid')

    stripeMocks.initialize.mockClear()
    stripeMocks.onboarding.mockClear()
    const management = renderToStaticMarkup(createElement(StripeEmbeddedOnboarding, { ...props, mode: 'management' }))
    expect(management).toContain('data-stripe-component="management"')
    expect(management).not.toContain('Muuda andmeid')
    expect(stripeMocks.onboarding).not.toHaveBeenCalled()
    const initializeOptions = stripeMocks.initialize.mock.calls[0]?.[0] as { fetchClientSecret: () => Promise<string> }
    await initializeOptions.fetchClientSecret()
    expect(stripeMocks.invoke).toHaveBeenLastCalledWith('start', 'management')
  })
})
