export type StoreDirectoryFeaturedProduct = {
  id: string
  name: string
  slug: string
  description: string
  price: number | null
  salePrice: number | null
  stock: number | null
  oneOfAKind: boolean
}

export type StoreDirectoryEntry = {
  id: string
  name: string
  slug: string
  hostname: string
  url: string
  imageUrl: string | null
  logoUrl: string | null
  featuredProduct: StoreDirectoryFeaturedProduct | null
  description: string
}

export function formatStoreDirectoryPrice(value: number): string
export function getStoreDirectoryFeaturedUrl(store: StoreDirectoryEntry): string
export function getStoreDirectoryVisitUrl(store: StoreDirectoryEntry): string
export function normalizeStoreDirectoryCatalog(value: unknown): StoreDirectoryEntry[]
