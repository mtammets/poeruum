export type PoeruumStore = {
  id: string
  name: string
  settings?: Record<string, unknown> | null
}

export const getStripePrefill = (store: PoeruumStore, fallbackEmail = '') => {
  const settings = store.settings && typeof store.settings === 'object' ? store.settings : {}
  const legalName = String(settings.businessName ?? store.name).trim()
  const registrationNumber = String(settings.registryCode ?? '').trim()
  const contactEmail = String(settings.contactEmail ?? fallbackEmail).trim()

  return {
    email: contactEmail || undefined,
    business_type: 'company' as const,
    business_profile: {
      name: legalName,
      product_description: `E-pood ${store.name} Poeruumi platvormil`,
      support_email: contactEmail || undefined,
    },
    company: {
      name: legalName,
      registration_number: registrationNumber || undefined,
      // Poeruum stores the registered address, which need not be the business's
      // operating address. Let Stripe collect the address its form asks for.
      // Never put an entire free-form registered address into a street field.
      address: { country: 'EE' },
    },
  }
}
