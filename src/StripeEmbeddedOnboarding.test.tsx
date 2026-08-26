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
})
