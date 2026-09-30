import type Stripe from 'npm:stripe@^22'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sellerType } from '../../../shared/seller.ts'
import { stripeSellerIdentityError, existingStripeAccountError, stripeAccountReady } from './stripe-oauth.ts'

type Store = { id: string; settings: Record<string, unknown>; stripe_account_id: string; stripe_account_mode: string; stripe_connection_type: string | null }

export const payoutBank = (banks: Stripe.BankAccount[]) => {
  const defaults = banks.filter(bank => bank.currency === 'eur' && bank.default_for_currency && !['errored', 'verification_failed'].includes(bank.status))
  if (defaults.length !== 1) return {}
  const bank = defaults[0]
  return { id: bank.id, fingerprint: bank.fingerprint ?? null, last4: bank.last4, country: bank.country,
    currency: bank.currency, bank_name: bank.bank_name, account_holder_name: bank.account_holder_name }
}

export async function syncSellerPaymentCheck(admin: SupabaseClient, stripe: Stripe, store: Store, account: Stripe.Account) {
  const individual = sellerType(store.settings) === 'entrepreneur'
  const identityError = store.stripe_connection_type === 'oauth'
    ? existingStripeAccountError(account, store.settings) : stripeSellerIdentityError(account, store.settings)
  const banks: Stripe.BankAccount[] = []
  if (individual) {
    for await (const bank of stripe.accounts.listExternalAccounts(account.id, { object: 'bank_account', limit: 100 })) {
      if (bank.object === 'bank_account') banks.push(bank)
    }
  }
  const bank = payoutBank(banks)
  const { data: ready, error } = await admin.rpc('sync_store_payment_check', {
    target_store_id: store.id, account_value: account.id, mode_value: store.stripe_account_mode,
    settings_value: store.settings, bank_value: bank, error_value: identityError, ready_value: stripeAccountReady(account),
  })
  if (error) throw error
  return { ready: ready === true, bank, setupError: identityError || (individual && !ready
    ? 'Ettevõtluskonto vajab Poeruumi toe kontrolli. Lisa Stripe’i väljamaksekontoks enda aktiivne LHV ettevõtluskonto ja kirjuta info@poeruum.ee.' : null) }
}
