export const DEFAULT_RETURNS_TEXT = 'Tarbijal on õigus e-poest ostetud kaubast 14 päeva jooksul pärast kauba kättesaamist taganeda. Taganemiseks saada müüja kontakt-e-postile ühemõtteline avaldus. Kauba tagastamise otsesed kulud kannab ostja, välja arvatud puudusega kauba korral. Raha tagastatakse 14 päeva jooksul pärast taganemisavalduse saamist; müüja võib tagasimaksega oodata, kuni kaup on tagastatud või ostja on esitanud tõendi selle saatmise kohta. Taganemisõigusele kehtivad seaduses sätestatud erandid.'

export const FIXED_PLAN_TRIAL_DAYS = 30

export type PricingPlan = 'flexible' | 'fixed'

export const createCheckoutRequestId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
