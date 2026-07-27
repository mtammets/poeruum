import type { Product } from './products'
import type { CustomDomainRecord } from './lib/database'

export type ShippingProvider = 'omniva' | 'dpd' | 'smartposti'
export type PaymentProvider = 'stripe' | 'montonio'

export type CartItem = Product & {
  cartKey: string
  quantity: number
  selectedOptions: Record<string, string>
}

export type StoreOrder = {
  id: string
  items: CartItem[]
  customerName: string
  customerEmail: string
  delivery: string
  productSubtotal: number
  total: number
  createdAt: string
  status: 'new' | 'fulfilled' | 'refunded'
  stripeProcessingFee?: number
  stripePlatformFee?: number
  stripePlatformFeeNet?: number
  stripePlatformFeeVat?: number
  stripeSellerNet?: number
}

export type DeliverySettings = {
  parcelProviders: Record<ShippingProvider, { enabled: boolean; price: number }>
  courierEnabled: boolean
  pickupEnabled: boolean
  courierPrice: number
  freeShippingFrom: number
  pickupAddress: string
}

export type StoreTheme = 'midnight' | 'paper' | 'pop'
export type BuyButtonSize = 'small' | 'medium' | 'large'
export type SaleBadgeStyle = 'quirky' | 'classic' | 'price' | 'elegant' | 'minimal'
export type AnnouncementSpeed = 'slow' | 'normal' | 'fast'
export type AnnouncementDirection = 'left' | 'right'
export type SettingsSection = 'store' | 'appearance' | 'payments' | 'delivery' | 'business' | 'links' | 'notifications' | 'billing' | 'account'
export type CustomDomainStatus = 'idle' | CustomDomainRecord['status']

export const SHIPPING_PROVIDERS: ShippingProvider[] = ['omniva', 'dpd', 'smartposti']
export const SHIPPING_PROVIDER_LABELS: Record<ShippingProvider, string> = {
  omniva: 'Omniva',
  dpd: 'DPD',
  smartposti: 'SmartPosti',
}

export const getProductPrice = (product: Product) =>
  product.salePrice !== undefined && product.price !== undefined && product.salePrice < product.price
    ? product.salePrice
    : product.price ?? 0

export const createCartKey = (productId: string, selectedOptions: Record<string, string>) =>
  `${productId}:${Object.entries(selectedOptions).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => `${name}=${value}`).join('|')}`

export const createCartItem = (product: Product, quantity = 1, selectedOptions: Record<string, string> = {}): CartItem => ({
  ...product,
  cartKey: createCartKey(product.id, selectedOptions),
  quantity,
  selectedOptions,
})

export const getDefaultProductOptions = (product: Product) => Object.fromEntries(
  (product.options ?? []).map((option) => [option.name, option.values[0] ?? '']),
)

export const getProductStockLimit = (product: Product) =>
  product.oneOfAKind ? 1 : product.stock ?? Number.POSITIVE_INFINITY

export const getResponsiveImageProps = (
  product: Product,
  image: string,
  preferred: 'thumb' | 'medium' | 'large' = 'large',
) => {
  const asset = product.imageVariants?.[image]
  if (!asset) return { src: image }
  const variants = Object.values(asset.variants)
    .filter((variant, index, all) => all.findIndex((candidate) => candidate.url === variant.url) === index)
    .sort((left, right) => left.width - right.width)
  return {
    src: asset.variants[preferred].url,
    srcSet: variants.map((variant) => `${variant.url} ${variant.width}w`).join(', '),
  }
}
