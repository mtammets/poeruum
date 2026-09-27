// Use the same integer-cent arithmetic in the storefront and Stripe checkout.
export const moneyToCents = (value: unknown) => Math.max(0, Math.round(Number(value ?? 0) * 100))

export function calculateOrderTotals(input: {
  items: Array<{ unitGrossCents: number; quantity: number }>
  deliveryCents: number
  freeShippingFromCents: number
  vatRegistered: boolean
}) {
  const productSubtotalCents = input.items.reduce((sum, item) => sum + item.unitGrossCents * item.quantity, 0)
  const deliveryCents = input.freeShippingFromCents > 0 && productSubtotalCents >= input.freeShippingFromCents
    ? 0 : input.deliveryCents
  const totalCents = productSubtotalCents + deliveryCents
  const vatCents = input.vatRegistered ? Math.round(totalCents * 24 / 124) : 0
  return { productSubtotalCents, deliveryCents, totalCents, vatCents }
}
