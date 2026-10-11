import { requireSupabase } from './supabase'

export type PayoutSession =
  | { kind: 'embedded'; clientSecret: string; mode: 'test' | 'live'; instantPayoutsEnabled: boolean }
  | { kind: 'dashboard'; dashboardUrl: string; mode: 'test' | 'live' }

export async function createPayoutSession(storeId: string): Promise<PayoutSession> {
  const { data, error } = await requireSupabase().functions.invoke('stripe-payouts', {
    body: { storeId }, signal: AbortSignal.timeout(30000),
  })
  if (error) {
    const response = 'context' in error && error.context instanceof Response ? error.context : null
    const detail = await response?.clone().json().catch(() => null)
    throw new Error(detail?.error || 'Väljamaksete laadimine ebaõnnestus. Proovi uuesti.')
  }
  if (!data || !['test', 'live'].includes(data.mode)
    || (data.kind !== 'embedded' && data.kind !== 'dashboard')
    || (data.kind === 'embedded' && typeof data.clientSecret !== 'string')
    || (data.kind === 'dashboard' && data.dashboardUrl !== 'https://dashboard.stripe.com/payouts')) {
    throw new Error('Väljamaksete avamine ebaõnnestus. Proovi uuesti.')
  }
  return data
}
