import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'

declare global {
  interface Window {
    __updateSettingsHarness?: (settings: Record<string, unknown>) => void
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
