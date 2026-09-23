import { getPublicShowcaseStore, listProducts, SHOWCASE_STORE_ID, type PublicStoreRecord } from './database'
import { getResponsiveImageProps } from '../storefrontModel'
import type { Product } from '../products'

// Match the inner phone screen, excluding its border and padding.
export const PHONE_IMAGE_SIZES = '(max-width: 760px) 13.5rem, 16rem'

type Showcase = { store: PublicStoreRecord | null; products: Product[] }
let cached: { value: Showcase; expires: number } | null = null
let pending: Promise<Showcase> | null = null

export function loadPublicShowcase(refresh = false): Promise<Showcase> {
  if (pending) return pending
  if (!refresh && cached && cached.expires > Date.now()) return Promise.resolve(cached.value)

  // The showcase ID is known, so the product request need not wait for the store.
  pending = Promise.all([getPublicShowcaseStore(), listProducts(SHOWCASE_STORE_ID)])
    .then(([store, products]) => {
      const value = { store, products: store ? products : [] }
      const firstProduct = value.products.find((product) => product.searchVisible !== false)
      if (firstProduct && typeof Image !== 'undefined') {
        const props = getResponsiveImageProps(firstProduct, firstProduct.image, 'medium')
        const image = new Image()
        image.fetchPriority = 'high'
        image.sizes = PHONE_IMAGE_SIZES
        if (props.srcSet) image.srcset = props.srcSet
        image.src = props.src
      }
      cached = { value, expires: Date.now() + 30_000 }
      return value
    })
    .finally(() => { pending = null })
  return pending
}
