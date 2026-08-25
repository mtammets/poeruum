import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'

declare global {
  interface Window {
    __updateSettingsHarness?: (settings: Record<string, unknown>) => void
    __stripeConnectCalls?: number
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
    onConnectPaymentProvider: () => {
      window.__stripeConnectCalls = (window.__stripeConnectCalls ?? 0) + 1
    },
  }))
}
