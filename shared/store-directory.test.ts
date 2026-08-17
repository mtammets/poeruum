import { describe, expect, it } from 'vitest'
import { normalizeStoreDirectoryCatalog } from './store-directory.mjs'

describe('store directory catalog', () => {
  it('keeps public store presentation concise and prefers a product image', () => {
    expect(normalizeStoreDirectoryCatalog([{
      store_id: 'store-1',
      store_name: '  Keraamika Stuudio  ',
      store_slug: 'keraamika-stuudio',
      primary_hostname: 'pood.example.ee',
      store_description: '  Käsitsi tehtud   nõud. ',
      store_logo: 'https://images.example.ee/logo.png',
      products: [{ image_url: 'https://images.example.ee/kruus.jpg' }],
    }])).toEqual([{
      id: 'store-1',
      name: 'Keraamika Stuudio',
      slug: 'keraamika-stuudio',
      hostname: 'pood.example.ee',
      url: 'https://pood.example.ee/',
      imageUrl: 'https://images.example.ee/kruus.jpg',
      description: 'Käsitsi tehtud nõud.',
    }])
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
