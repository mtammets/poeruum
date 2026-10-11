import type { ReceiptAccess } from '../../shared/order-receipt'
import type { StoreWithdrawal, WithdrawalInput, WithdrawalConfirmation } from '../../shared/withdrawal'
import { requireSupabase } from './supabase'
export type WithdrawalStore = { storeId: string } | { storeSlug: string } | { access: ReceiptAccess }
export async function submitWithdrawal(store: WithdrawalStore, input: WithdrawalInput): Promise<WithdrawalConfirmation> {
  const { data, error } = await requireSupabase().functions.invoke('order-withdrawal', { body: { ...store, ...input }, signal: AbortSignal.timeout(25000) })
  if (error) {
    const response = 'context' in error && error.context instanceof Response ? error.context : null
    const detail = await response?.clone().json().catch(() => null)
    throw new Error(detail?.error || 'Avalduse esitamine ebaõnnestus. Proovi uuesti.')
  }
  if (!data?.confirmation?.id || !data.confirmation.submittedAt || !data.confirmation.statement) throw new Error('Kinnitus jäi saamata. Proovi sama avaldust uuesti saata.')
  return data.confirmation
}
export async function listWithdrawals(storeId: string): Promise<StoreWithdrawal[]> {
  const { data, error } = await requireSupabase().from('store_withdrawals')
    .select('id,order_id,order_reference,customer_name,customer_email,scope,statement,submitted_at,status')
    .eq('store_id', storeId).order('submitted_at', { ascending: false }).limit(200)
  if (error) throw new Error('Taganemisavalduste laadimine ebaõnnestus.')
  return data
}
export async function reviewWithdrawal(id: string) {
  const { error } = await requireSupabase().rpc('review_store_withdrawal', { target_id: id })
  if (error) throw new Error('Avalduse märkimine ebaõnnestus. Proovi uuesti.')
}
