import { sellerName, sellerType } from '../../../shared/seller.ts'

export type PoeruumStore = {
  id: string
  name: string
  settings?: Record<string, unknown> | null
}

export const getStripePrefill = (store: PoeruumStore, fallbackEmail = '') => {
  const settings = store.settings && typeof store.settings === 'object' ? store.settings : {}
  const legalName = sellerName(settings) || store.name
  const registrationNumber = String(settings.registryCode ?? '').trim()
  const contactEmail = String(settings.contactEmail ?? fallbackEmail).trim()

  return {
    email: contactEmail || undefined,
    business_profile: {
      name: legalName,
      product_description: `E-pood ${store.name} Poeruumi platvormil`,
      support_email: contactEmail || undefined,
    },
    ...(sellerType(settings) === 'entrepreneur' ? {
      business_type: 'individual' as const,
      individual: {
        first_name: String(settings.sellerFirstName ?? '').trim() || undefined,
        last_name: String(settings.sellerLastName ?? '').trim() || undefined,
        email: contactEmail || undefined,
        address: { country: 'EE' },
      },
    } : {
      business_type: 'company' as const,
      company: {
        name: legalName,
        registration_number: registrationNumber || undefined,
        // Poeruum stores the registered address, which need not be the business's
        // operating address. Let Stripe collect the address its form asks for.
        // Never put an entire free-form registered address into a street field.
        address: { country: 'EE' },
      },
    }),
  }
}
