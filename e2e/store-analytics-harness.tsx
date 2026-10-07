import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'
import '../src/styles.css'
import '../src/brand.css'
import '../src/platform.css'

export function mountStoreAnalyticsHarness(merchantMode = true) {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(Storefront, {
    storeId: '10000000-0000-4000-8000-000000000071', storeName: 'Mavi Stuudio', storeSlug: 'analytics-store', merchantMode,
    initialSettings: { editableStoreName: 'Mavi Stuudio', businessName: 'Mavi OÜ', registryCode: '12345678',
      businessAddress: 'Tallinn', contactEmail: 'mavi@example.invalid', storeDescription: 'Käsitsi valmistatud keraamika.' },
    seedProducts: [{ id: 'analytics-cup', name: 'Käsitöökruus', image: '/images/kaubamaja-example-ceramics.webp', alt: 'Keraamika', description: 'Käsitsi valmistatud kruus.', price: 25, stock: 20 }],
  }))
}
