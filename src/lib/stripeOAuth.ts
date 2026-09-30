export function stripeDashboardUrl(accountId: string, mode?: 'test' | 'live' | null) {
  if (!/^acct_[a-zA-Z0-9]+$/.test(accountId)) throw new Error('Stripe’i kontot ei leitud.')
  return `https://dashboard.stripe.com/${accountId}/${mode === 'test' ? 'test/' : ''}settings/payouts`
}
