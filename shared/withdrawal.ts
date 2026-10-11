// A declaration records the buyer's intent; it never authorizes a refund.
export type WithdrawalInput = {
  requestId: string
  customerName: string
  customerEmail: string
  orderReference: string
  scope: string
}
export type WithdrawalConfirmation = { id: string; submittedAt: string; statement: string }
export type StoreWithdrawal = {
  id: string; order_id: string | null; order_reference: string; customer_name: string; customer_email: string
  scope: string; statement: string; submitted_at: string; status: 'new' | 'reviewed'
}
export const withdrawalTime = (value: string) => new Intl.DateTimeFormat('et-EE', {
  dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Tallinn',
}).format(new Date(value))
export const withdrawalStatement = (value: Pick<WithdrawalInput, 'orderReference' | 'scope'>) =>
  `Taganen müügilepingust. Tellimus: ${value.orderReference}.${value.scope ? `\nTaganemine puudutab: ${value.scope}` : '\nTaganemine puudutab kogu tellimust.'}`
export const parseWithdrawal = (value: unknown): WithdrawalInput | null => {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  const fields = ['requestId', 'customerName', 'customerEmail', 'orderReference', 'scope'] as const
  if (fields.some((key) => typeof body[key] !== 'string')) return null
  const cleaned = Object.fromEntries(fields.map((key) => [key, (body[key] as string).trim()])) as WithdrawalInput
  cleaned.customerEmail = cleaned.customerEmail.toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleaned.requestId)
    || !cleaned.customerName || cleaned.customerName.length > 120
    || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(cleaned.customerEmail) || cleaned.customerEmail.length > 254
    || !cleaned.orderReference || cleaned.orderReference.length > 120 || cleaned.scope.length > 2000
    || [cleaned.customerName, cleaned.customerEmail, cleaned.orderReference].some((text) => /[\p{Cc}]/u.test(text))
    || /[\p{Cc}]/u.test(cleaned.scope.replace(/[\n\r\t]/g, ''))) return null
  return cleaned
}
