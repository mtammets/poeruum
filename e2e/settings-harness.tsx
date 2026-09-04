import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'
import type { Product } from '../src/products'

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
      issues: [{
        code: 'verification_document_address_mismatch',
        requirement: 'company.verification.document',
      }],
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
      issues: [],
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
      issues: [],
    },
  })
}

export function mountLateStripeRequirementsLinkHarness() {
  const root = document.createElement('div')
  root.id = 'late-stripe-requirements-link-harness'
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(LateStripeRequirementsLinkHarness))
}

const categoryProducts: Product[] = [
  { id: 'category-product-1', categoryId: 'category-jewelry', name: 'Hõbedane sõrmus', description: 'Käsitsi valmistatud ehe', image: '/e2e-images/ring.jpg', alt: 'Hõbedane sõrmus', price: 24 },
  { id: 'category-product-2', categoryId: 'category-home', name: 'Savikruus', description: 'Keraamiline kruus', image: '/e2e-images/cup.jpg', alt: 'Savikruus', price: 18 },
  { id: 'category-product-3', categoryId: 'category-home', name: 'Lauavaas', description: 'Väike vaas', image: '/e2e-images/vase.jpg', alt: 'Lauavaas', price: 21 },
]

const categorySeeds = [
  { id: 'category-jewelry', storeId: '', name: 'Ehted', slug: 'ehted', sortOrder: 0 },
  { id: 'category-home', storeId: '', name: 'Kodu', slug: 'kodu', sortOrder: 1 },
  { id: 'category-empty', storeId: '', name: 'Tühi', slug: 'tuhi', sortOrder: 2 },
]

export function mountCategorySearchHarness() {
  const root = document.createElement('div')
  root.id = 'category-search-harness'
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(Storefront, {
    seedProducts: categoryProducts,
    seedCategories: categorySeeds,
    storeName: 'Kategooriapood',
  }))
}

export function mountCategoryEditorHarness() {
  const root = document.createElement('div')
  root.id = 'category-editor-harness'
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(Storefront, {
    seedProducts: categoryProducts,
    seedCategories: categorySeeds,
    storeName: 'Kategooriapood',
    merchantMode: true,
  }))
}
