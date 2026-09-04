import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'
import Kaubamaja from '../src/Kaubamaja'
import type { Product } from '../src/products'

export function mountDirectoryHarness() {
  const imageUrl = `${window.location.origin}/images/poeruumi-kaubamaja-hero.webp`
  const data = document.createElement('script')
  data.id = 'poeruum-store-directory-data'
  data.type = 'application/json'
  data.textContent = JSON.stringify([{
    store_id: 'store-1',
    store_name: 'Keraamika Stuudio',
    store_slug: 'keraamika-stuudio',
    directory_description: 'Eesti savist käsitsi valminud nõud.',
    directory_cover: imageUrl,
    products: [{ id: 'product-1', name: 'Kruus', image_url: imageUrl, price: 25 }],
  }, {
    store_id: 'store-2',
    store_name: 'Põhjala Puit',
    store_slug: 'pohjala-puit',
    store_description: 'Ajatud puidust esemed sinu koju.',
    products: [{ id: 'product-2', name: 'Lõikelaud', image_url: imageUrl, price: 45 }],
  }])
  const root = document.createElement('div')
  root.id = 'directory-harness'
  document.body.replaceChildren(data, root)
  createRoot(root).render(createElement(Kaubamaja))
}

const returnHarnessProduct: Product = {
  id: 'return-product-1',
  name: 'Käsitöökruus',
  description: 'Eesti savist valminud kruus.',
  image: '/images/poeruumi-kaubamaja-hero.webp',
  alt: 'Käsitöökruus',
  price: 25,
  stock: 3,
}

const mountStorefrontReturnHarness = (fromDirectory: boolean, clearSession: boolean) => {
  const storeSlug = 'tagasitee-pood'
  if (clearSession) window.sessionStorage.removeItem(`poeruum:directory-return:${storeSlug}`)
  window.history.replaceState({}, '', fromDirectory ? '/?from=kaubamaja' : '/')
  const root = document.createElement('div')
  root.id = 'storefront-return-harness'
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(Storefront, {
    seedProducts: [returnHarnessProduct],
    storeName: 'Tagasitee Pood',
    storeSlug,
    initialSettings: { storeDescription: 'Väike Eesti käsitööpood.' },
  }))
}

export function mountStorefrontFromDirectoryHarness() {
  mountStorefrontReturnHarness(true, true)
}

export function remountRememberedDirectoryStorefrontHarness() {
  mountStorefrontReturnHarness(false, false)
}

export function mountDirectStorefrontHarness() {
  mountStorefrontReturnHarness(false, true)
}
