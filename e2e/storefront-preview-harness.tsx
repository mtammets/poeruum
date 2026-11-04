import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'

export function mountStorefrontPreviewHarness() {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(Storefront, { seedProducts: [], onExit: () => undefined }))
}

export function mountStorefrontNavigationHarness(count = 4, imageCount = 1, autoplay = false) {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(Storefront, {
    storeId: 'navigation-store', storeName: 'Ringipood', storeSlug: 'ringipood', initialProductSlug: autoplay ? undefined : `toode-${count}`,
    initialSettings: { autoSwipeEnabled: autoplay, autoSwipeDelay: 1, autoSwipeSpeed: 1 },
    seedProducts: Array.from({ length: count }, (_, index) => ({
      id: `product-${index + 1}`, slug: `toode-${index + 1}`, name: `Ese ${index + 1}`,
      image: '/images/kaubamaja-example-ceramics.webp', alt: `Ese ${index + 1}`, price: (index + 1) * 10, stock: 5,
      gallery: imageCount > 1 ? Array.from({ length: imageCount }, (_, imageIndex) =>
        `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${['#ab4530', '#325a93', '#40824a'][imageIndex % 3]}"/><text x="100" y="400" fill="white" font-size="60">${index + 1}:${imageIndex + 1}</text></svg>`)}`) : undefined,
    })),
  }))
}
