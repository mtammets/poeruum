export type StoreDirectoryEntry = {
  id: string
  name: string
  slug: string
  hostname: string
  url: string
  imageUrl: string | null
  description: string
}

export function normalizeStoreDirectoryCatalog(value: unknown): StoreDirectoryEntry[]
