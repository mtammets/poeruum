import type { StoreDirectoryEntry } from '../../shared/store-directory.mjs'
import { getStoreBySlug, listPublicStoreDirectory, listProducts, type PublicStoreRecord } from './database'
import { getResponsiveImageProps } from '../storefrontModel'
import type { Product } from '../products'
import { getHomepageStoreIds } from './homepageShowcase'

// Match the mobile viewport rendered inside the scaled phone frame.
export const PHONE_IMAGE_SIZES = '390px'
const CARD_STORE_SLUGS = ['moreamoreceramics', 'kruk-kruk', 'urgits']

type Showcase = { stores: StoreDirectoryEntry[]; store: StoreDirectoryEntry | null; storefront: PublicStoreRecord | null; products: Product[] }
let cached: { value: Showcase; expires: number } | null = null
let pending: Promise<Showcase> | null = null

function shuffled<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[randomIndex]] = [result[randomIndex], result[index]]
  }
  return result
}

export function loadPublicShowcase(refresh = false): Promise<Showcase> {
  if (pending) return pending
  if (!refresh && cached && cached.expires > Date.now()) return Promise.resolve(cached.value)

  pending = Promise.all([listPublicStoreDirectory(), getHomepageStoreIds()])
    .then(async ([catalog, selectedStoreIds]) => {
      const eligibleStores = catalog.map((store) => ({
        ...store,
        products: store.products.filter((product) => product.imageUrl && product.price !== null && product.stock !== 0),
      })).filter((store) => store.products.length > 0)
      const stores = [
        ...CARD_STORE_SLUGS.flatMap((slug) => eligibleStores.filter((store) => store.slug === slug)),
        ...eligibleStores.filter((store) => !CARD_STORE_SLUGS.includes(store.slug)),
      ].slice(0, 3)
      // Choose a shop before choosing products so small catalogs get equal exposure.
      const candidates = shuffled(eligibleStores.filter((store) => selectedStoreIds.includes(store.id)))
      const previousId = cached?.value.store?.id
      const previousIndex = candidates.findIndex((store) => store.id === previousId)
      if (previousIndex > 0) candidates.unshift(...candidates.splice(previousIndex, 1))
      let store: StoreDirectoryEntry | null = null
      let products: Product[] = []
      let storefront: PublicStoreRecord | null = null
      let loadError: unknown
      for (const candidate of candidates) {
        try {
          const [details, items] = await Promise.all([getStoreBySlug(candidate.slug), listProducts(candidate.id)])
          const eligible = items.filter((product) => product.image && product.searchVisible !== false
            && product.price !== undefined && Number.isFinite(product.price) && product.price >= 0
            && (product.stock === undefined || product.stock > 0))
          if (details?.id !== candidate.id || !details.is_published || !eligible.length) continue
          store = candidate
          storefront = details
          // Preserve both shop and product order when the tab regains focus.
          const previousProducts = previousId === store.id ? cached?.value.products ?? [] : []
          const byId = new Map(eligible.map((product) => [product.id, product]))
          products = [
            ...previousProducts.flatMap((product) => byId.has(product.id) ? [byId.get(product.id)!] : []),
            ...shuffled(eligible.filter((product) => !previousProducts.some((previous) => previous.id === product.id))),
          ]
          break
        } catch (error) {
          loadError = error
        }
      }
      if (!store && loadError) throw loadError
      const value = { stores, store, storefront, products }
      // Keeping object references prevents an unchanged iframe from restarting.
      if (cached && JSON.stringify(value) === JSON.stringify(cached.value)) {
        cached.expires = Date.now() + 30_000
        return cached.value
      }
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
