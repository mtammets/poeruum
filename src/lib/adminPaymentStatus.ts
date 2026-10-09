import { requireSupabase } from './supabase'
import type { PaymentDiagnostics } from '../../shared/paymentDiagnostics'

export function preferredPaymentDiagnostic(saved?: PaymentDiagnostics | null, fresh?: PaymentDiagnostics) {
  if (!fresh) return saved
  if (!saved) return fresh
  if (fresh.userId !== saved.userId || fresh.storeId !== saved.storeId || fresh.dashboardUrl !== saved.dashboardUrl || fresh.mode !== saved.mode) return saved
  if (Date.parse(fresh.checkedAt || '') >= Date.parse(saved.checkedAt || '1970-01-01')) return fresh
  // A saved summary has no missing-field list. Keep the more precise Stripe
  // result when the summary only advances the timestamp for the same state.
  const sameState = (['connected', 'chargesEnabled', 'payoutsEnabled', 'identityError', 'disabledReason', 'pendingVerification', 'dueCount'] as const)
    .every((key) => fresh[key] === saved[key])
  const issues = (d: PaymentDiagnostics) => d.issues.map((issue) => `${issue.code}:${issue.requirement ?? ''}`).sort().join('|')
  return sameState && issues(fresh) === issues(saved) ? fresh : saved
}

export async function paymentStatusRequest(body: { action: 'snapshot'; userIds: string[] } | { userId: string }, signal?: AbortSignal) {
  const { data, error } = await requireSupabase().functions.invoke('admin-payment-status', { body, signal, timeout: 20_000 })
  if (error) {
    const response = error.context
    const details = response instanceof Response ? await response.json().catch(() => null) : null
    throw new Error(details?.error || 'Maksete täpset seisu ei õnnestunud laadida.')
  }
  if (data?.error) throw new Error(data.error)
  return data as { diagnostic?: PaymentDiagnostics; diagnostics?: PaymentDiagnostics[] }
}

export async function savedPaymentStatuses(userIds: string[]) {
  const result: PaymentDiagnostics[] = []
  for (let i = 0; i < userIds.length; i += 500) {
    const data = await paymentStatusRequest({ action: 'snapshot', userIds: userIds.slice(i, i + 500) })
    if (!Array.isArray(data.diagnostics)) throw new Error('Maksete põhjused pole kättesaadavad.')
    result.push(...data.diagnostics.filter((item) => item?.version === 1))
  }
  return result
}
