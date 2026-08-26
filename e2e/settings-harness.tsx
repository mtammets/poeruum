import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'

declare global {
  interface Window {
    __updateSettingsHarness?: (settings: Record<string, unknown>) => void
    __stripeConnectCalls?: number
    __stripeConnectPurpose?: 'requirements' | 'management'
    __openLateStripeRequirementsSettings?: () => void
  }
}

function SettingsHarness() {
  const [initialSettings, setInitialSettings] = useState<Record<string, unknown>>({
    storeDescription: 'Serveri algne väärtus',
  })
  window.__updateSettingsHarness = setInitialSettings

  return createElement(Storefront, {
    storeId: '10000000-0000-4000-8000-000000000099',
    seedProducts: [],
    storeName: 'Testipood',
    storeSlug: 'testipood',
    initialSettings,
    merchantMode: true,
    initialPublished: false,
    paymentsReady: false,
  })
}

export function mountSettingsHarness() {
  const root = document.createElement('div')
  root.id = 'settings-harness'
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(SettingsHarness))
}

export function mountStripeRequirementsHarness() {
  window.__stripeConnectCalls = 0
  window.__stripeConnectPurpose = undefined
  const root = document.createElement('div')
  root.id = 'stripe-requirements-harness'
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(Storefront, {
    storeId: '10000000-0000-4000-8000-000000000098',
    seedProducts: [],
    storeName: 'Stripe nõuete testipood',
    storeSlug: 'stripe-nouete-testipood',
    initialSettings: {},
    merchantMode: true,
    initialPublished: true,
    paymentsReady: true,
    stripeRequirements: {
      dueCount: 2,
      pastDue: false,
      currentDeadline: '2026-10-09T00:00:00.000Z',
      pendingVerification: false,
      disabledReason: null,
    },
    onConnectPaymentProvider: (_provider, purpose) => {
      window.__stripeConnectCalls = (window.__stripeConnectCalls ?? 0) + 1
      window.__stripeConnectPurpose = purpose
    },
  }))
}

export function mountStripeRequirementsLinkHarness() {
  const root = document.createElement('div')
  root.id = 'stripe-requirements-link-harness'
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(Storefront, {
    storeId: '10000000-0000-4000-8000-000000000097',
    seedProducts: [],
    storeName: 'Stripe lingi testipood',
    storeSlug: 'stripe-lingi-testipood',
    initialSettings: {},
    initialSettingsSection: 'payments',
    merchantMode: true,
    initialPublished: true,
    paymentsReady: true,
    stripeRequirements: {
      dueCount: 1,
      pastDue: false,
      currentDeadline: '2026-10-09T00:00:00.000Z',
      pendingVerification: false,
      disabledReason: null,
    },
  }))
}

function LateStripeRequirementsLinkHarness() {
  const [initialSettingsSection, setInitialSettingsSection] = useState<'payments' | null>(null)
  window.__openLateStripeRequirementsSettings = () => setInitialSettingsSection('payments')

  return createElement(Storefront, {
    storeId: '10000000-0000-4000-8000-000000000096',
    seedProducts: [],
    storeName: 'Stripe hilise lingi testipood',
    storeSlug: 'stripe-hilise-lingi-testipood',
    initialSettings: {},
    initialSettingsSection,
    onInitialSettingsSectionOpened: () => setInitialSettingsSection(null),
    merchantMode: true,
    initialPublished: true,
    paymentsReady: true,
    stripeRequirements: {
      dueCount: 1,
      pastDue: false,
      currentDeadline: '2026-10-09T00:00:00.000Z',
      pendingVerification: false,
      disabledReason: null,
    },
  })
}

export function mountLateStripeRequirementsLinkHarness() {
  const root = document.createElement('div')
  root.id = 'late-stripe-requirements-link-harness'
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(LateStripeRequirementsLinkHarness))
}
