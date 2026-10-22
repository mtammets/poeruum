import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStoreBySlug, listProducts, type PublicStoreRecord } from '../../lib/database'
import { loadKrukPurchase } from './krukPurchase'

vi.mock('../../lib/database', () => ({ getStoreBySlug: vi.fn(), listProducts: vi.fn() }))

const product = { id: 'cap', name: 'Nokkmüts', image: 'cap.webp', alt: 'Nokkmüts', price: 24.42, salePrice: 19.9, stock: 2 }
const store: PublicStoreRecord = {
  id: 'shop', slug: 'kruk-kruk', name: 'Krük-Krük', is_published: true,
  payment_provider: 'stripe', payment_status: 'connected', shipping: ['dpd'],
  settings: { vatRegistered: false, deliverySettings: {
    parcelProviders: { omniva: { enabled: false, price: 0 }, dpd: { enabled: true, price: 2.9 }, smartposti: { enabled: false, price: 0 } },
    courierEnabled: false, courierPrice: 0, pickupEnabled: false, pickupAddress: '', freeShippingFrom: 50,
  } },
}

beforeEach(() => {
  vi.mocked(getStoreBySlug).mockResolvedValue(structuredClone(store))
  vi.mocked(listProducts).mockResolvedValue([structuredClone(product)])
})

describe('campaign purchase', () => {
  it('uses refreshed price, quantity and actual delivery settings', async () => {
    vi.mocked(listProducts).mockResolvedValue([{ ...product, salePrice: 18 }])
    const purchase = await loadKrukPurchase('shop', 'cap')
    expect(purchase.item).toMatchObject({ id: 'cap', salePrice: 18, quantity: 1, selectedOptions: {} })
    expect(purchase.deliverySettings.parcelProviders.dpd).toEqual({ enabled: true, price: 2.9 })
  })
  it('rejects stock that sold out after the directory loaded', async () => {
    vi.mocked(listProducts).mockResolvedValue([{ ...product, stock: 0, oneOfAKind: true }])
    await expect(loadKrukPurchase('shop', 'cap')).rejects.toThrow('pole praegu ostmiseks saadaval')
  })
  it('does not silently choose a size or colour for the buyer', async () => {
    vi.mocked(listProducts).mockResolvedValue([{ ...product, options: [{ name: 'Suurus', values: ['S', 'L'] }] }])
    await expect(loadKrukPurchase('shop', 'cap')).rejects.toThrow('vali sobiv variant')
  })
  it('rejects a different store or disconnected payments', async () => {
    await expect(loadKrukPurchase('another-shop', 'cap')).rejects.toThrow('Pood pole praegu saadaval')
    vi.mocked(getStoreBySlug).mockResolvedValue({ ...store, payment_status: 'pending' })
    await expect(loadKrukPurchase('shop', 'cap')).rejects.toThrow('ei saa praegu makseid')
  })
  it('does not invent delivery prices when configuration is missing', async () => {
    vi.mocked(getStoreBySlug).mockResolvedValue({ ...store, settings: {} })
    await expect(loadKrukPurchase('shop', 'cap')).rejects.toThrow('Tarneviise ei õnnestunud laadida')
  })
})
