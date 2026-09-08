import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'

export const descriptionStoreId = '10000000-0000-4000-8000-000000000091'
export const descriptionImage = `http://localhost:4174/storage/v1/object/public/product-images/${descriptionStoreId}/image/medium.webp`
export const descriptionProduct = {
  id: 'description-product', store_id: descriptionStoreId, name: 'Savivaas', alt: 'Savivaas',
  description: 'Kõrgus 25 cm.', image_url: descriptionImage, gallery: [descriptionImage], price: 25, search_visible: true,
}

export function mountProductDescriptionHarness() {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  createRoot(root).render(<Storefront
    storeId={descriptionStoreId}
    storeName="Testipood"
    storeSlug="testipood"
    merchantMode
    seedProducts={[{ id: descriptionProduct.id, name: descriptionProduct.name, alt: descriptionProduct.alt, image: descriptionImage, description: descriptionProduct.description, price: 25 }]}
  />)
}
