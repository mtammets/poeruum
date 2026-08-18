import { describe, expect, it } from 'vitest'
import {
  formatStoreDirectoryPrice,
  getStoreDirectoryFeaturedUrl,
  normalizeStoreDirectoryCatalog,
} from './store-directory.mjs'

describe('store directory catalog', () => {
  it('keeps public store presentation concise and prefers a product image', () => {
    expect(normalizeStoreDirectoryCatalog([{
      store_id: 'store-1',
      store_name: '  Keraamika Stuudio  ',
      store_slug: 'keraamika-stuudio',
      primary_hostname: 'pood.example.ee',
      store_description: '  Käsitsi tehtud   nõud. ',
      store_logo: 'https://images.example.ee/logo.png',
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
      imageUrl: 'https://images.example.ee/kruus.jpg',
      logoUrl: 'https://images.example.ee/logo.png',
      featuredProduct: {
        id: 'product-1',
        name: 'Kruus',
        slug: 'kruus',
        description: 'Treitud sangaga käsitöökruus.',
        price: 25,
        salePrice: 19.99,
        stock: 2,
        oneOfAKind: false,
      },
      description: 'Käsitsi tehtud nõud.',
    }])
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
})
