export type StripeMode = 'test' | 'live'

export const stripeModeFromKey = (key: string): StripeMode => {
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test'
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live'
  throw new Error('STRIPE_SECRET_KEY pole korrektne Stripe’i salajane võti.')
}

export const assertStripeMode = (key: string) => {
  const actual = stripeModeFromKey(key)
  const expected = Deno.env.get('STRIPE_MODE')?.trim()
  if (expected && expected !== actual) throw new Error(`Stripe’i võtme režiim (${actual}) ei vasta STRIPE_MODE väärtusele (${expected}).`)
  return actual
}

export const assertStoredStripeMode = (stored: unknown, actual: StripeMode, label: string) => {
  if (stored && stored !== actual) throw new Error(`${label} kuulub Stripe’i ${stored}-režiimi; aktiivne võti on ${actual}-režiimis.`)
}
