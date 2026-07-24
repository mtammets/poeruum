export const DEFAULT_RETURNS_TEXT = 'Tarbijal on õigus e-poest ostetud kaubast 14 päeva jooksul pärast kauba kättesaamist taganeda. Taganemiseks saada müüja kontakt-e-postile ühemõtteline avaldus. Kauba tagastamise otsesed kulud kannab ostja, välja arvatud puudusega kauba korral. Raha tagastatakse 14 päeva jooksul pärast taganemisavalduse saamist; müüja võib tagasimaksega oodata, kuni kaup on tagastatud või ostja on esitanud tõendi selle saatmise kohta. Taganemisõigusele kehtivad seaduses sätestatud erandid.'

export const FIXED_PLAN_TRIAL_DAYS = 30

export const VAT_RATE = 0.24
export const PLATFORM_FEE_RATE = 0.04
export const PLATFORM_FEE_NET_CAP = 39
export const PLATFORM_FEE_GROSS_CAP = PLATFORM_FEE_NET_CAP * (1 + VAT_RATE)
export const FIXED_PLAN_MONTHLY_FEE = 29
export const FIXED_PLAN_MONTHLY_VAT = FIXED_PLAN_MONTHLY_FEE * VAT_RATE
export const FIXED_PLAN_MONTHLY_TOTAL = FIXED_PLAN_MONTHLY_FEE + FIXED_PLAN_MONTHLY_VAT

export const formatPricingEuro = (value: number) =>
  `${value.toFixed(Number.isInteger(value) ? 0 : 2).replace('.', ',')} €`

export const formatPricingPercent = (value: number) =>
  `${(value * 100).toFixed(Number.isInteger(value * 100) ? 0 : 2).replace('.', ',')}%`

export type PricingPlan = 'flexible' | 'fixed'

export const createCheckoutRequestId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
