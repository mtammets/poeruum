import { describe, expect, it } from 'vitest'
import { normalizeStoreDirectoryCatalog } from '../../shared/store-directory.mjs'
import { createStoreDirectorySearch } from './directorySearch'

const stores = normalizeStoreDirectoryCatalog([{
  store_id: 'ceramics', store_name: 'Keraamika Stuudio', store_slug: 'keraamika', store_description: 'Käsitöö sinu koju.',
  products: [
    { id: 'mug', name: 'Kruus', description: 'Sobib kokku meie vaasiga.' },
    { id: 'vase', name: 'Vaas', description: 'Sinine lillevaas.' },
    { id: 'hidden', name: 'Salajane', search_visible: false },
  ],
}, {
  store_id: 'wood', store_name: 'Põhjala Puit', store_slug: 'pohjala-puit',
  products: [
    { id: 'board', name: 'Lõikelaud', description: 'Tammepuidust köögitarvik.' },
    { id: 'vase-2', name: 'Puidust vaas', description: 'Ümar lillevaas.' },
  ],
}, {
  store_id: 'empty', store_name: 'Uus Pood', store_slug: 'uus-pood',
}])
const search = createStoreDirectorySearch(stores)
const productIds = (query: string) => search(query).products.map(({ product }) => product.id)

describe('Kaubamaja search', () => {
  it('searches every public product and ranks names ahead of description matches', () => {
    expect(productIds('vaas')).toEqual(['vase', 'vase-2', 'mug'])
    expect(search('vaas').stores).toEqual([])
    expect(productIds('salajane')).toEqual([])
  })

  it('matches Estonian names with or without accents, mixed case and punctuation', () => {
    expect(productIds('  LÕIKELAUD  ')).toEqual(['board'])
    expect(productIds('loikelaud')).toEqual(['board'])
    expect(productIds('pOhJaLa, KÖÖGI')).toEqual(['board'])
    expect(search('kasitoo').stores.map((store) => store.id)).toEqual(['ceramics'])
  })

  it('requires every search term and includes the store name in product matches', () => {
    expect(productIds('pohjala vaas')).toEqual(['vase-2'])
    expect(productIds('vaas pohjala')).toEqual(['vase-2'])
    expect(productIds('pohjala kruus')).toEqual([])
    expect(productIds('Keraamika')).toEqual(['mug', 'vase'])
    expect(search('uus pood').stores.map((store) => store.id)).toEqual(['empty'])
  })

  it('handles empty and unmatched queries without mutating subsequent result order', () => {
    for (const query of ['', '   ', '---', 'jalgratas']) {
      expect(search(query)).toEqual({ stores: [], products: [] })
    }
    expect(productIds('vaas')).toEqual(['vase', 'vase-2', 'mug'])
    search('kruus')
    expect(productIds('vaas')).toEqual(['vase', 'vase-2', 'mug'])
  })
})
