import type { StoreDirectoryEntry, StoreDirectoryProduct } from '../../shared/store-directory.mjs'

export type DirectoryProductResult = { store: StoreDirectoryEntry; product: StoreDirectoryProduct }

const normalizeSearchText = (value: string) => value
  .toLocaleLowerCase('et')
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

const indexEntry = <T,>(value: T, name: string, description: string) => ({
  value,
  name: normalizeSearchText(name),
  text: normalizeSearchText(`${name} ${description}`),
})

// Prepare searchable text once when the public catalog changes.
export function createStoreDirectorySearch(stores: StoreDirectoryEntry[]) {
  const storeIndex = stores.map((store) => indexEntry(store, store.name, store.description))
  const productIndex = stores.flatMap((store) => store.products.map((product) =>
    indexEntry({ store, product }, product.name, `${product.description} ${store.name}`),
  ))

  return (query: string): { stores: StoreDirectoryEntry[]; products: DirectoryProductResult[] } => {
    const normalized = normalizeSearchText(query)
    if (!normalized) return { stores: [], products: [] }
    const terms = normalized.split(' ')
    const rank = (name: string) => name === normalized ? 0
      : name.includes(normalized) ? 1
      : terms.every((term) => name.includes(term)) ? 2
      : terms.some((term) => name.includes(term)) ? 3 : 4
    const matches = <T,>(entries: { value: T; name: string; text: string }[]) => entries
      .filter((entry) => terms.every((term) => entry.text.includes(term)))
      .sort((a, b) => rank(a.name) - rank(b.name))
      .map((entry) => entry.value)
    return { stores: matches(storeIndex), products: matches(productIndex) }
  }
}
