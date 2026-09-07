export type StoreDirectoryProduct = {
  id: string
  name: string
  slug: string
  description: string
  imageUrl: string | null
  price: number | null
  salePrice: number | null
  stock: number | null
  oneOfAKind: boolean
}

export type StoreDirectoryFeaturedProduct = StoreDirectoryProduct

export type StoreDirectoryEntry = {
  id: string
  name: string
  slug: string
  hostname: string
  url: string
  imageUrl: string | null
  logoUrl: string | null
  featuredProduct: StoreDirectoryFeaturedProduct | null
  products: StoreDirectoryProduct[]
  description: string
}

export function formatStoreDirectoryPrice(value: number): string
export const storeDirectoryExamples: Pick<StoreDirectoryEntry, 'id' | 'name' | 'description' | 'imageUrl' | 'logoUrl' | 'url'>[]
export function getStoreDirectoryFeaturedUrl(store: StoreDirectoryEntry): string
export function getStoreDirectoryVisitUrl(store: StoreDirectoryEntry, product?: StoreDirectoryProduct): string
export function normalizeStoreDirectoryCatalog(value: unknown): StoreDirectoryEntry[]
