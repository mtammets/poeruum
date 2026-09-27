export const DEFAULT_RETURNS_TEXT = 'Tarbijal on õigus e-poest ostetud kaubast 14 päeva jooksul pärast kauba kättesaamist taganeda. Taganemiseks saada müüja kontakt-e-postile ühemõtteline avaldus. Kauba tagastamise otsesed kulud kannab ostja, välja arvatud puudusega kauba korral. Raha tagastatakse 14 päeva jooksul pärast taganemisavalduse saamist; müüja võib tagasimaksega oodata, kuni kaup on tagastatud või ostja on esitanud tõendi selle saatmise kohta. Taganemisõigusele kehtivad seaduses sätestatud erandid.'

export {
  FIXED_PLAN_TRIAL_DAYS,
  VAT_RATE,
  PLATFORM_FEE_RATE,
  PLATFORM_FEE_NET_CAP,
  PLATFORM_FEE_GROSS_CAP,
  FIXED_PLAN_MONTHLY_FEE,
  FIXED_PLAN_MONTHLY_VAT,
  FIXED_PLAN_MONTHLY_TOTAL,
  formatPricingEuro,
  formatPricingPercent,
} from '../shared/platform-pricing.mjs'

export type PricingPlan = 'flexible' | 'fixed'

export const createCheckoutRequestId = createRandomId
import { createRandomId } from './lib/randomId'
