import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'
import type { Product } from '../src/products'

export function mountProductImageOrderHarness(product: Product) {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  createRoot(root).render(<Storefront
    storeId="10000000-0000-4000-8000-000000000093"
    storeName="Pildipood" storeSlug="pildipood" merchantMode seedProducts={[product]}
  />)
}
