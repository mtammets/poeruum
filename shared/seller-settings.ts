import { normalizeSellerSettings, sellerType, type SellerType } from './seller.ts'

export type SellerSettings = {
  sellerType: SellerType
  sellerFirstName: string
  sellerLastName: string
  entrepreneurPayoutConfirmed: boolean
  businessName: string
  registryCode: string
  businessAddress: string
  contactEmail: string
  vatRegistered: boolean
  vatNumber: string
}

// Keep this projection aligned with public.store_seller_settings(jsonb).
export function sellerSettings(value: Record<string, unknown>): SellerSettings {
  const text = (key: string) => typeof value[key] === 'string' ? value[key] as string : ''
  return {
    sellerType: sellerType(value), sellerFirstName: text('sellerFirstName'), sellerLastName: text('sellerLastName'),
    entrepreneurPayoutConfirmed: value.entrepreneurPayoutConfirmed === true,
    businessName: text('businessName'), registryCode: text('registryCode'), businessAddress: text('businessAddress'),
    contactEmail: text('contactEmail'), vatRegistered: value.vatRegistered === true, vatNumber: text('vatNumber'),
  }
}

export function cleanSellerSettings(value: SellerSettings): SellerSettings {
  const cleaned = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'string' ? item.trim() : item]))
  if (!cleaned.vatRegistered) cleaned.vatNumber = ''
  return sellerSettings(normalizeSellerSettings(cleaned))
}

export function sellerIdentityChanged(before: SellerSettings, after: SellerSettings) {
  return before.sellerType !== after.sellerType || (after.sellerType === 'entrepreneur'
    ? before.sellerFirstName !== after.sellerFirstName || before.sellerLastName !== after.sellerLastName
    : before.businessName !== after.businessName || before.registryCode !== after.registryCode)
}
