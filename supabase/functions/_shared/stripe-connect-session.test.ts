import { describe, expect, it } from 'vitest'
import {
  canCreateStripeConnectAccount,
  getStripeConnectSessionComponents,
  parseStripeConnectSessionMode,
  resolveStripeConnectSessionMode,
} from './stripe-connect-session.ts'

describe('Stripe Connect account session modes', () => {
  it('accepts the focused remediation mode without broadening invalid input', () => {
    expect(parseStripeConnectSessionMode('remediation')).toBe('remediation')
    expect(parseStripeConnectSessionMode('management')).toBe('management')
    expect(parseStripeConnectSessionMode('onboarding')).toBe('onboarding')
    expect(parseStripeConnectSessionMode('anything-else')).toBe('onboarding')
    expect(parseStripeConnectSessionMode(null)).toBe('onboarding')
  })

  it('keeps remediation focused for an existing managed account', () => {
    expect(resolveStripeConnectSessionMode(true, 'remediation')).toBe('remediation')
    expect(resolveStripeConnectSessionMode(true, 'onboarding')).toBe('remediation')
    expect(resolveStripeConnectSessionMode(true, 'onboarding', false)).toBe('onboarding')
    expect(resolveStripeConnectSessionMode(false, 'onboarding')).toBe('onboarding')
  })

  it('keeps the rendered onboarding component available if completion races the session request', () => {
    const mode = resolveStripeConnectSessionMode(true, 'onboarding', true)
    expect(getStripeConnectSessionComponents(mode)).toEqual({
      account_onboarding: {
        enabled: true,
        features: {
          external_account_collection: false,
          disable_stripe_user_authentication: true,
        },
      },
    })
  })

  it('keeps payout-account collection available when initial onboarding was interrupted', () => {
    const mode = resolveStripeConnectSessionMode(true, 'onboarding', false)
    expect(getStripeConnectSessionComponents(mode)).toEqual({
      account_onboarding: {
        enabled: true,
        features: {
          external_account_collection: true,
          disable_stripe_user_authentication: true,
        },
      },
    })
  })

  it('creates an account only for explicit first-time onboarding', () => {
    expect(canCreateStripeConnectAccount(false, 'onboarding')).toBe(true)
    expect(canCreateStripeConnectAccount(false, 'management')).toBe(false)
    expect(canCreateStripeConnectAccount(false, 'remediation')).toBe(false)
    expect(canCreateStripeConnectAccount(true, 'onboarding')).toBe(false)
    expect(canCreateStripeConnectAccount(true, 'management')).toBe(false)
    expect(canCreateStripeConnectAccount(true, 'remediation')).toBe(false)
  })

  it('enables only focused onboarding for remediation', () => {
    const components = getStripeConnectSessionComponents('remediation')

    expect(components).toEqual({
      account_onboarding: {
        enabled: true,
        features: {
          external_account_collection: false,
          disable_stripe_user_authentication: true,
        },
      },
    })
    expect(components).not.toHaveProperty('account_management')
    expect(components).not.toHaveProperty('notification_banner')
  })

  it('keeps broad authenticated account management separate from remediation', () => {
    expect(getStripeConnectSessionComponents('management')).toEqual({
      account_management: {
        enabled: true,
        features: {
          external_account_collection: true,
          disable_stripe_user_authentication: false,
        },
      },
      notification_banner: {
        enabled: true,
        features: {
          external_account_collection: true,
          disable_stripe_user_authentication: false,
        },
      },
    })
  })
})
