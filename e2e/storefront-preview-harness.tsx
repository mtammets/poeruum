import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'

export function mountStorefrontPreviewHarness() {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(Storefront, { seedProducts: [], onExit: () => undefined }))
}

export function mountStorefrontNavigationHarness(count = 4) {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(Storefront, {
    storeName: 'Ringipood', storeSlug: 'ringipood', initialProductSlug: `toode-${count}`,
    initialSettings: { autoSwipeEnabled: false },
    seedProducts: Array.from({ length: count }, (_, index) => ({
      id: `product-${index + 1}`, slug: `toode-${index + 1}`, name: `Ese ${index + 1}`,
      image: '/images/kaubamaja-example-ceramics.webp', alt: `Ese ${index + 1}`, price: (index + 1) * 10, stock: 5,
    })),
  }))
}
