export const PLATFORM_BUSINESS: Readonly<{
  name: string; registryCode: string; vatNumber: string; vatRegistrationDate: string;
  vatRegistrationInstant: string; address: string; email: string; country: 'EE'; vatPercent: number;
}>
export function platformVatPercentAt(value: string | number | Date): number
export function estonianBillingMonth(value: string | number | Date): string
