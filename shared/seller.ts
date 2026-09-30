export type SellerType = 'company' | 'entrepreneur'

export const sellerType = (settings: Record<string, unknown>): SellerType =>
  settings.sellerType === 'entrepreneur' ? 'entrepreneur' : 'company'

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const validText = (value: unknown, maximum: number) => {
  const valueText = text(value)
  return Boolean(valueText && valueText.length <= maximum && !Array.from(valueText).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
}

export function sellerName(settings: Record<string, unknown>) {
  return sellerType(settings) === 'entrepreneur'
    ? [text(settings.sellerFirstName), text(settings.sellerLastName)].filter(Boolean).join(' ')
    : text(settings.businessName)
}

// Missing type is a legacy company. Unknown types must not bypass validation.
export function sellerDetailsError(settings: Record<string, unknown>): string | null {
  if (settings.sellerType !== undefined && settings.sellerType !== 'company' && settings.sellerType !== 'entrepreneur') return 'Vali müüja tüüp.'
  if (sellerType(settings) === 'entrepreneur') {
    if (!validText(settings.sellerFirstName, 100) || !validText(settings.sellerLastName, 100)) return 'Lisa ees- ja perekonnanimi.'
    if (settings.entrepreneurPayoutConfirmed !== true) return 'Kinnita enda aktiivse ettevõtluskonto kasutamine müüja andmetes.'
    if (settings.vatRegistered === true || text(settings.vatNumber)) return 'Ettevõtluskonto kasutaja ei saa olla käibemaksukohustuslane.'
  } else {
    if (!validText(settings.businessName, 200)) return 'Lisa ettevõtte nimi.'
    if (!/^\d{8}$/.test(text(settings.registryCode))) return 'Registrikood peab olema 8-kohaline.'
    if (settings.vatRegistered === true && !/^EE\d{9}$/.test(text(settings.vatNumber))) return 'KMKR number peab olema kujul EE123456789.'
  }
  if (!validText(settings.businessAddress, 400)) return 'Lisa müüja aadress.'
  if (!validText(settings.contactEmail, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(settings.contactEmail))) return 'Lisa toimiv kontakt-e-post.'
  return null
}

export const hasSellerDetails = (settings: Record<string, unknown>) => sellerDetailsError(settings) === null

// Never place an individual's identifier in the company's public registry field.
export function normalizeSellerSettings(settings: Record<string, unknown>) {
  return sellerType(settings) === 'entrepreneur'
    ? { ...settings, businessName: sellerName(settings), registryCode: '', vatRegistered: false, vatNumber: '' }
    : settings
}
