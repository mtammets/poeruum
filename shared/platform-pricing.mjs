// Shared by the app and the generated public pages. Keep displayed prices aligned.
export const FIXED_PLAN_TRIAL_DAYS = 30
export const VAT_RATE = 0.24
export const PLATFORM_FEE_RATE = 0.04
export const PLATFORM_FEE_NET_CAP = 39
export const PLATFORM_FEE_GROSS_CAP = PLATFORM_FEE_NET_CAP * (1 + VAT_RATE)
export const FIXED_PLAN_MONTHLY_FEE = 29
export const FIXED_PLAN_MONTHLY_VAT = FIXED_PLAN_MONTHLY_FEE * VAT_RATE
export const FIXED_PLAN_MONTHLY_TOTAL = FIXED_PLAN_MONTHLY_FEE + FIXED_PLAN_MONTHLY_VAT

export const formatPricingEuro = (value) =>
  `${value.toFixed(Number.isInteger(value) ? 0 : 2).replace('.', ',')} €`

export const formatPricingPercent = (value) =>
  `${(value * 100).toFixed(Number.isInteger(value * 100) ? 0 : 2).replace('.', ',')}%`
