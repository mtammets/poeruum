// Animaator OÜ's own invoicing identity, separate from every shop's seller.
export const PLATFORM_BUSINESS = Object.freeze({
  name: 'Animaator OÜ',
  registryCode: '17135632',
  vatNumber: 'EE103036036',
  vatRegistrationDate: '2026-10-01',
  vatRegistrationInstant: '2026-09-30T21:00:00.000Z', // Midnight in Estonia.
  address: 'Alle, Pudisoo küla, Kuusalu vald, Harju maakond 74626, Eesti',
  email: 'info@poeruum.ee',
  country: 'EE',
  vatPercent: 24,
})

export function platformVatPercentAt(value) {
  const instant = new Date(value).getTime()
  if (!Number.isFinite(instant)) throw new Error('Invalid platform tax date')
  return instant >= Date.parse(PLATFORM_BUSINESS.vatRegistrationInstant) ? PLATFORM_BUSINESS.vatPercent : 0
}

export const estonianBillingMonth = (value) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit' }).formatToParts(new Date(value))
  return `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}`
}
