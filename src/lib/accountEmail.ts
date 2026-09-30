import { requireSupabase } from './supabase'

export type AccountEmailStatus = {
  email: string
  pending_email: string | null
  email_confirmed: boolean
  is_disposable: boolean
  activation_allowed: boolean
  candidate_is_disposable: boolean | null
}

export const merchantEmailMessage = 'Enne poe avaldamist või maksete ühendamist vaheta konto ajutine e-post püsiva aadressi vastu ja kinnita see.'

export async function getAccountEmailStatus(candidateEmail?: string): Promise<AccountEmailStatus> {
  const { data, error } = await requireSupabase().rpc('account_email_status', {
    candidate_email: candidateEmail ?? null,
  })
  if (error) throw new Error('Konto e-posti kontroll ebaõnnestus. Proovi uuesti.')
  if (!data || typeof data.activation_allowed !== 'boolean') throw new Error('Konto e-posti kontroll ebaõnnestus. Proovi uuesti.')
  return data as AccountEmailStatus
}

export async function requireMerchantEmail() {
  const status = await getAccountEmailStatus()
  if (!status.activation_allowed) throw new Error(status.is_disposable
    ? merchantEmailMessage
    : 'Enne poe avaldamist või maksete ühendamist kinnita konto e-posti aadress.')
}
