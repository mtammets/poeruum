export type StripeConnectSessionMode = 'onboarding' | 'management' | 'remediation'

export const parseStripeConnectSessionMode = (value: unknown): StripeConnectSessionMode => {
  if (value === 'management' || value === 'remediation') return value
  return 'onboarding'
}

export const resolveStripeConnectSessionMode = (
  hasExistingManagedAccount: boolean,
  requestedMode: StripeConnectSessionMode,
): StripeConnectSessionMode => {
  // Never let an established payout account fall back to the broad first-time
  // onboarding session. The focused remediation session is deliberately safe
  // for returning accounts because it cannot collect or change bank details.
  if (hasExistingManagedAccount && requestedMode === 'onboarding') return 'management'
  return requestedMode
}

export const canCreateStripeConnectAccount = (
  hasStoredAccountId: boolean,
  requestedMode: StripeConnectSessionMode,
) => !hasStoredAccountId && requestedMode === 'onboarding'

export const getStripeConnectSessionComponents = (mode: StripeConnectSessionMode) => {
  if (mode === 'management') {
    return {
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
    }
  }

  if (mode === 'remediation') {
    return {
      account_onboarding: {
        enabled: true,
        features: {
          // Requirement emails open a focused compliance form. Bank-account
          // changes remain in authenticated management mode.
          external_account_collection: false,
          disable_stripe_user_authentication: true,
        },
      },
    }
  }

  return {
    account_onboarding: {
      enabled: true,
      features: {
        external_account_collection: true,
        disable_stripe_user_authentication: true,
      },
    },
  }
}
