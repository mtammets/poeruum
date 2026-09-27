import type { StoreDirectoryEntry } from '../../shared/store-directory.mjs'
import { getStoreBySlug, listPublicStoreDirectory, listProducts, type PublicStoreRecord } from './database'
import { getResponsiveImageProps } from '../storefrontModel'
import type { Product } from '../products'

// Match the mobile viewport rendered inside the scaled phone frame.
export const PHONE_IMAGE_SIZES = '390px'
const FEATURED_STORE_SLUGS = ['moreamoreceramics', 'kruk-kruk', 'urgits']

type Showcase = { stores: StoreDirectoryEntry[]; store: StoreDirectoryEntry | null; storefront: PublicStoreRecord | null; products: Product[] }
let cached: { value: Showcase; expires: number } | null = null
let pending: Promise<Showcase> | null = null

export function loadPublicShowcase(refresh = false): Promise<Showcase> {
  if (pending) return pending
  if (!refresh && cached && cached.expires > Date.now()) return Promise.resolve(cached.value)

  pending = listPublicStoreDirectory()
    .then(async (catalog) => {
      const eligibleStores = catalog.map((store) => ({
        ...store,
        products: store.products.filter((product) => product.imageUrl && product.price !== null && product.stock !== 0),
      })).filter((store) => store.products.length > 0)
      const stores = [
        ...FEATURED_STORE_SLUGS.flatMap((slug) => eligibleStores.filter((store) => store.slug === slug)),
        ...eligibleStores.filter((store) => !FEATURED_STORE_SLUGS.includes(store.slug)),
      ].slice(0, 3)
      const store = stores[0] ?? null
      let products: Product[] = []
      let storefront: PublicStoreRecord | null = null
      if (store) {
        // The phone renders the actual storefront, including its settings and full catalog.
        const [details, items] = await Promise.all([
          getStoreBySlug(store.slug).catch(() => null),
          listProducts(store.id).catch(() => []),
        ])
        if (details?.id === store.id && details.is_published) storefront = details
        // Shuffle a copy for the homepage preview and preload its first product.
        products = [...items]
        for (let index = products.length - 1; index > 0; index -= 1) {
          const randomIndex = Math.floor(Math.random() * (index + 1))
          ;[products[index], products[randomIndex]] = [products[randomIndex], products[index]]
        }
      }
      const value = { stores, store, storefront, products }
      const firstProduct = products[0]
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
