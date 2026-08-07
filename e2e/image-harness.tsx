import { createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { OrderItemThumbnail, Storefront } from '../src/App'
import type { Product } from '../src/products'
import { createCartItem } from '../src/storefrontModel'

const createProduct = (id: string, name: string, image: string, gallery?: string[]): Product => ({
  id,
  name,
  image,
  gallery: gallery ?? [image],
  alt: name,
  description: `${name} kirjeldus`,
  price: 20,
  stock: 5,
})

const mount = (node: ReactNode, id: string) => {
  const root = document.createElement('div')
  root.id = id
  document.body.replaceChildren(root)
  createRoot(root).render(node)
}

export function mountOrderImageHarness() {
  const historicalProduct = createProduct('product-1', 'Ajalooline toode', '/e2e-images/missing.jpg')
  const currentProduct = createProduct('product-1', 'Praegune toode', '/e2e-images/current.jpg')
  mount(createElement(OrderItemThumbnail, {
    item: createCartItem(historicalProduct),
    currentProduct,
  }), 'order-image-harness')
}

export function mountStorefrontImageHarness() {
  const firstImage = '/e2e-images/first.jpg'
  const secondImage = '/e2e-images/second.jpg'
  const products = [
    createProduct('product-1', 'Esimene toode', firstImage, [firstImage, '/e2e-images/gallery.jpg']),
    createProduct('product-2', 'Teine toode', secondImage),
  ]
  mount(createElement(Storefront, {
    storeId: '10000000-0000-4000-8000-000000000098',
    seedProducts: products,
    storeName: 'Pildipood',
    storeSlug: 'pildipood',
    initialSettings: {
      editableStoreName: 'Pildipood',
      storeDescription: 'Poe tutvustus',
      storeLogo: '/e2e-images/logo.jpg',
      storeAboutImage: '/e2e-images/about.jpg',
    },
  }), 'storefront-image-harness')
}
