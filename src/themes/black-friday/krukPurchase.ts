import { getStoreBySlug, listProducts } from '../../lib/database'
import { createCartItem, getDefaultProductOptions, SHIPPING_PROVIDERS, type DeliverySettings } from '../../storefrontModel'

// Refresh the real product at purchase time; directory data may be stale.
export async function loadKrukPurchase(storeId: string, productId: string) {
  const [store, products] = await Promise.all([getStoreBySlug('kruk-kruk'), listProducts(storeId)])
  if (!store || store.id !== storeId || !store.is_published) throw new Error('Pood pole praegu saadaval.')
  if (store.payment_provider !== 'stripe' || store.payment_status !== 'connected') throw new Error('Pood ei saa praegu makseid vastu võtta.')
  const product = products.find(product => product.id === productId && product.searchVisible !== false)
  if (!product || product.stock === 0 || product.price === undefined || !Number.isFinite(product.price) || product.price < 0) {
    throw new Error('See toode pole praegu ostmiseks saadaval.')
  }
  if (product.options?.some(option => option.values.length !== 1)) {
    throw new Error('Enne ostmist vali sobiv variant tootelehel.')
  }
  const delivery = store.settings.deliverySettings as DeliverySettings | undefined
  const validPrice = (price: unknown) => typeof price === 'number' && Number.isFinite(price) && price >= 0
  if (!delivery?.parcelProviders
    || !SHIPPING_PROVIDERS.every(provider => {
      const service = delivery.parcelProviders[provider]
      return service && typeof service.enabled === 'boolean' && (!service.enabled || validPrice(service.price))
    })
    || (delivery.courierEnabled && !validPrice(delivery.courierPrice))
    || !validPrice(delivery.freeShippingFrom)
    || !(SHIPPING_PROVIDERS.some(provider => delivery.parcelProviders[provider].enabled) || delivery.courierEnabled || delivery.pickupEnabled)) {
    throw new Error('Tarneviise ei õnnestunud laadida. Proovi uuesti või ava tooteleht.')
  }
  return {
    storeId: store.id,
    item: createCartItem(product, 1, getDefaultProductOptions(product)),
    deliverySettings: delivery,
    vatRegistered: store.settings.vatRegistered === true,
    contactEmail: typeof store.settings.contactEmail === 'string' ? store.settings.contactEmail : '',
    returnsText: typeof store.settings.returnsText === 'string' ? store.settings.returnsText : '',
  }
}

export type KrukPurchase = Awaited<ReturnType<typeof loadKrukPurchase>>
