import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Product } from '../products'
import { normalizeStoreDirectoryCatalog } from '../../shared/store-directory.mjs'

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), ids: vi.fn(), store: vi.fn(), products: vi.fn() }))
vi.mock('./database', () => ({ listPublicStoreDirectory: mocks.catalog, getStoreBySlug: mocks.store, listProducts: mocks.products }))
vi.mock('./homepageShowcase', () => ({ getHomepageStoreIds: mocks.ids }))

const product = (id: string): Product => ({ id, name: id, image: `https://example.test/${id}.webp`, price: 10, alt: id, stock: 1 })
const catalog = normalizeStoreDirectoryCatalog(['first', 'second', 'excluded'].map((id) => ({
  store_id: id, store_slug: id, store_name: id,
  products: [{ id, name: id, image_url: `https://example.test/${id}.webp`, price: 10, stock: 1 }],
})))

beforeEach(() => {
  vi.restoreAllMocks(); vi.resetModules(); vi.resetAllMocks()
  mocks.catalog.mockResolvedValue(catalog)
  mocks.ids.mockResolvedValue(['first', 'second'])
  mocks.store.mockImplementation(async (id: string) => ({ id, slug: id, name: id, is_published: true }))
  mocks.products.mockImplementation(async (id: string) => id === 'first'
    ? Array.from({ length: 16 }, (_, index) => product(`first-${index}`)) : [product(id)])
})

describe('homepage shop selection', () => {
  it.each([[0, 'second'], [.999, 'first']])('selects a shop before its products (%s)', async (random, expected) => {
    vi.spyOn(Math, 'random').mockReturnValue(Number(random))
    const { loadPublicShowcase } = await import('./showcase')
    const value = await loadPublicShowcase()
    expect(value.store?.id).toBe(expected)
    expect(mocks.products).toHaveBeenCalledTimes(1)
    expect(value.stores.map((store) => store.id)).toEqual(['first', 'second', 'excluded'])
  })

  it('shares the initial request and preserves shop, product order and iframe data across focus refreshes', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(.999)
    const { loadPublicShowcase } = await import('./showcase')
    const firstRequest = loadPublicShowcase()
    expect(loadPublicShowcase()).toBe(firstRequest)
    const first = await firstRequest
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const refreshed = await loadPublicShowcase(true)
    expect(refreshed).toBe(first)
    expect(refreshed.products).toBe(first.products)
  })

  it('uses only the selected shop even when it is outside the three cards', async () => {
    mocks.catalog.mockResolvedValue([...catalog, ...normalizeStoreDirectoryCatalog([{
      store_id: 'fourth', store_slug: 'fourth', store_name: 'Fourth',
      products: [{ id: 'fourth', name: 'Fourth', image_url: 'https://example.test/fourth.webp', price: 10 }],
    }])])
    mocks.ids.mockResolvedValue(['fourth'])
    const { loadPublicShowcase } = await import('./showcase')
    const value = await loadPublicShowcase()
    expect(value.store?.id).toBe('fourth')
    expect(value.stores.map((store) => store.id)).not.toContain('fourth')
  })

  it('filters unavailable products and tries another selected shop when a shop becomes unpublished', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(.999)
    mocks.store.mockImplementation(async (id: string) => ({ id, is_published: id !== 'first' }))
    mocks.products.mockResolvedValue([
      product('good'), { ...product('sold'), stock: 0 }, { ...product('hidden'), searchVisible: false },
      { ...product('image'), image: '' }, { ...product('price'), price: undefined },
    ])
    const { loadPublicShowcase } = await import('./showcase')
    const value = await loadPublicShowcase()
    expect(value.store?.id).toBe('second')
    expect(value.products.map((p) => p.id)).toEqual(['good'])
  })

  it('falls back only to other selected shops on a load failure', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(.999)
    mocks.store.mockImplementation(async (id: string) => { if (id === 'first') throw new Error('Offline'); return { id, is_published: true } })
    const { loadPublicShowcase } = await import('./showcase')
    expect((await loadPublicShowcase()).store?.id).toBe('second')
    expect(mocks.store).not.toHaveBeenCalledWith('excluded')
  })

  it('omits the phone when no selected store is eligible, without picking an unselected shop', async () => {
    mocks.ids.mockResolvedValue(['deleted'])
    const { loadPublicShowcase } = await import('./showcase')
    const value = await loadPublicShowcase()
    expect(value.store).toBeNull()
    expect(value.stores).toHaveLength(3)
    expect(mocks.products).not.toHaveBeenCalled()
  })

  it('retains a successful cache after a failed settings refresh and respects a later admin change', async () => {
    mocks.ids.mockResolvedValue(['first'])
    const { loadPublicShowcase } = await import('./showcase')
    const first = await loadPublicShowcase()
    mocks.ids.mockRejectedValueOnce(new Error('Offline'))
    await expect(loadPublicShowcase(true)).rejects.toThrow('Offline')
    expect(await loadPublicShowcase()).toBe(first)
    mocks.ids.mockResolvedValue(['second'])
    expect((await loadPublicShowcase(true)).store?.id).toBe('second')
  })
})
