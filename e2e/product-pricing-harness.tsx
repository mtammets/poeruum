import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'

export function mountProductPricingHarness(salePrice?: number) {
  const storeId = '10000000-0000-4000-8000-000000000092'
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  createRoot(root).render(<Storefront
    storeId={storeId}
    storeName="Testipood"
    storeSlug="testipood"
    merchantMode
    seedProducts={[{
      id: 'pricing-product', name: 'Savivaas', alt: 'Savivaas', description: 'Kõrgus 25 cm.',
      image: `http://localhost:4174/storage/v1/object/public/product-images/${storeId}/image/medium.webp`,
      price: 25, salePrice,
    }]}
  />)
}
