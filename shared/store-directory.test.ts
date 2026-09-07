import { describe, expect, it } from 'vitest'
import {
  formatStoreDirectoryPrice,
  getStoreDirectoryFeaturedUrl,
  getStoreDirectoryVisitUrl,
  normalizeStoreDirectoryCatalog,
} from './store-directory.mjs'

describe('store directory catalog', () => {
  it('keeps public store presentation concise and prefers the merchant directory cover', () => {
    expect(normalizeStoreDirectoryCatalog([{
      store_id: 'store-1',
      store_name: '  Keraamika Stuudio  ',
      store_slug: 'keraamika-stuudio',
      primary_hostname: 'pood.example.ee',
      store_description: '  Käsitsi tehtud   nõud. ',
      store_logo: 'https://images.example.ee/logo.png',
      directory_description: '  Eesti savist   valminud nõud. ',
      directory_cover: 'https://images.example.ee/kaubamaja-cover.png',
      products: [{
        id: 'product-1',
        name: 'Kruus',
        slug: 'kruus',
        description: '  Treitud sangaga   käsitöökruus. ',
        image_url: 'https://images.example.ee/kruus.jpg',
        price: 25,
        sale_price: 19.99,
        stock: 2,
        one_of_a_kind: false,
      }],
    }])).toEqual([{
      id: 'store-1',
      name: 'Keraamika Stuudio',
      slug: 'keraamika-stuudio',
      hostname: 'pood.example.ee',
      url: 'https://pood.example.ee/',
      imageUrl: 'https://images.example.ee/kaubamaja-cover.png',
      logoUrl: 'https://images.example.ee/logo.png',
      featuredProduct: {
        id: 'product-1',
        name: 'Kruus',
        slug: 'kruus',
        description: 'Treitud sangaga käsitöökruus.',
        imageUrl: 'https://images.example.ee/kruus.jpg',
        price: 25,
        salePrice: 19.99,
        stock: 2,
        oneOfAKind: false,
      },
      products: [expect.objectContaining({ id: 'product-1', name: 'Kruus', imageUrl: 'https://images.example.ee/kruus.jpg' })],
      description: 'Eesti savist valminud nõud.',
    }])
  })

  it('falls back to the first visible product image and store description', () => {
    expect(normalizeStoreDirectoryCatalog([{
      store_id: 'store-1',
      store_name: 'Hea Pood',
      store_slug: 'hea-pood',
      store_description: 'Hoolikalt valitud tooted.',
      products: [{
        id: 'product-1',
        name: 'Toode',
        image_url: 'https://images.example.ee/toode.jpg',
      }],
    }])).toEqual([expect.objectContaining({
      imageUrl: 'https://images.example.ee/toode.jpg',
      description: 'Hoolikalt valitud tooted.',
    })])
  })

  it('keeps normalized SSR entries stable and formats Estonian prices', () => {
    const [store] = normalizeStoreDirectoryCatalog([{
      id: 'store-1',
      name: 'Hea Pood',
      slug: 'hea-pood',
      hostname: 'hea-pood.poeruum.ee',
      imageUrl: 'https://images.example.ee/toode.webp',
      logoUrl: 'https://images.example.ee/logo.webp',
      featuredProduct: {
        id: 'product-1',
        name: 'Toode',
        slug: 'toode',
        description: 'Hea toode.',
        price: 50,
        salePrice: 39.99,
        stock: 1,
        oneOfAKind: true,
      },
    }])

    expect(store).toEqual(expect.objectContaining({
      logoUrl: 'https://images.example.ee/logo.webp',
      featuredProduct: expect.objectContaining({ price: 50, salePrice: 39.99 }),
    }))
    expect(formatStoreDirectoryPrice(39.99)).toBe('39,99 €')
    expect(formatStoreDirectoryPrice(45)).toBe('45 €')
    expect(getStoreDirectoryFeaturedUrl(store)).toBe('https://hea-pood.poeruum.ee/toode/toode/')
    expect(getStoreDirectoryVisitUrl(store)).toBe('https://hea-pood.poeruum.ee/?from=kaubamaja')
  })

  it('excludes the directory address itself and malformed entries', () => {
    expect(normalizeStoreDirectoryCatalog([
      { store_id: 'directory', store_name: 'URGITS', store_slug: 'kaubamaja' },
      { store_id: 'invalid', store_name: 'Katki', store_slug: '../katki' },
      { store_id: 'valid', store_name: 'Hea Pood', store_slug: 'hea-pood' },
    ])).toEqual([expect.objectContaining({
      id: 'valid',
      url: 'https://hea-pood.poeruum.ee/',
    })])
  })

  it('preserves the full public product catalog across server serialization and client normalization', () => {
    const catalog = normalizeStoreDirectoryCatalog([{
      store_id: 'store-1', store_name: 'Hea Pood', store_slug: 'hea-pood', primary_hostname: 'pood.example.ee',
      products: [
        { id: 'cover', name: 'Kaanetoode', image_url: '/cover.webp' },
        { id: 'second', name: 'Teine toode', slug: 'teine toode', description: 'Poe sees.', price: '20', sale_price: '15', stock: 0 },
        { id: 'no-slug', name: 'Ilma aadressita', image_url: 'javascript:alert(1)' },
        { id: 'hidden', name: 'Peidetud', search_visible: false },
        { id: 'hidden-normalized', name: 'Peidetud', searchVisible: false },
        { id: 'second', name: 'Duplikaat' },
        { id: 'invalid' },
        null,
      ],
    }])
    expect(normalizeStoreDirectoryCatalog(JSON.parse(JSON.stringify(catalog)))).toEqual(catalog)
    const [store] = catalog
    expect(store.products.map((product) => product.id)).toEqual(['cover', 'second', 'no-slug'])
    expect(store.products[1]).toMatchObject({ price: 20, salePrice: 15, stock: 0 })
    expect(store.products[2].imageUrl).toBeNull()
    expect(getStoreDirectoryVisitUrl(store, store.products[1])).toBe('https://pood.example.ee/toode/teine%20toode/?from=kaubamaja')
    expect(getStoreDirectoryVisitUrl(store, store.products[2])).toBe('https://pood.example.ee/toode/no-slug/?from=kaubamaja')
  })
})
