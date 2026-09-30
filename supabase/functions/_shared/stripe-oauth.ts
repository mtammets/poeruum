import { sellerName, sellerType } from '../../../shared/seller.ts'

export const STRIPE_OAUTH_CALLBACK = '/stripe/connect/callback'
export const STRIPE_OAUTH_LIFETIME_MS = 15 * 60 * 1000

export function createStripeOAuthState(openerOrigin: string, mode: 'test' | 'live') {
  const origin = new URL(openerOrigin)
  if (origin.origin !== openerOrigin || openerOrigin.length > 300 || (origin.protocol !== 'https:' && !(mode === 'test' && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) {
    throw new Error('Konto ühendamise aadress ei sobi.')
  }
  // The origin is not a redirect destination. It limits postMessage to the tab
  // that opened Stripe, including merchants on their own shop domain.
  return `${crypto.randomUUID()}${crypto.randomUUID()}|${openerOrigin}`
}

export async function hashOAuthState(state: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function stripeOAuthUrl(clientId: string, appUrl: string, state: string, mode: 'test' | 'live') {
  if (!/^ca_[a-zA-Z0-9]+$/.test(clientId)) throw new Error('Olemasoleva konto ühendamine pole veel seadistatud.')
  const callback = new URL(STRIPE_OAUTH_CALLBACK, appUrl)
  if (callback.protocol !== 'https:' && !(mode === 'test' && callback.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(callback.hostname))) {
    throw new Error('Stripe’i tagasisuunamise aadress ei sobi.')
  }
  const url = new URL('https://connect.stripe.com/oauth/authorize')
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: 'read_write',
    redirect_uri: callback.href, state }).toString()
  return url.href
}

type OAuthAccount = {
  id: string; deleted?: boolean | void; type?: string; country?: string
  business_type?: string | null
  individual?: { first_name?: string | null; last_name?: string | null } | null
  company?: { name?: string | null; registration_number?: string | null } | null
  charges_enabled?: boolean; payouts_enabled?: boolean
  capabilities?: { transfers?: string; card_payments?: string }
}

const normalizedName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('et')

// Connecting an existing account must never rewrite its legal identity or bank.
export function existingStripeAccountError(account: OAuthAccount, settings: Record<string, unknown>) {
  if (account.deleted || account.type !== 'standard') return 'Vali iseseisev Stripe’i konto, mida saad ise Stripe’is hallata.'
  if (account.country !== 'EE') return 'Vali Eestis registreeritud Stripe’i konto.'
  const individual = sellerType(settings) === 'entrepreneur'
  if (account.business_type !== (individual ? 'individual' : 'company')) {
    return individual ? 'Vali enda eraisiku Stripe’i konto.' : 'Vali oma ettevõtte Stripe’i konto.'
  }
  const accountName = individual
    ? `${account.individual?.first_name ?? ''} ${account.individual?.last_name ?? ''}`.trim()
    : account.company?.name ?? ''
  if (!accountName) return 'Täienda Stripe’is konto omaniku andmeid ja proovi uuesti.'
  if (normalizedName(accountName) !== normalizedName(sellerName(settings))) return 'Stripe’i konto omaniku nimi peab ühtima müüja nimega.'
  if (!individual && account.company?.registration_number && account.company.registration_number !== String(settings.registryCode ?? '').trim()) {
    return 'Stripe’i konto registrikood peab ühtima müüja registrikoodiga.'
  }
  return null
}

export const stripeAccountReady = (account: OAuthAccount) => Boolean(account.charges_enabled && account.payouts_enabled && account.capabilities?.transfers === 'active')

// No retries: Stripe revokes the connection if the same code is exchanged twice.
// Do not return or persist the legacy access/refresh tokens Stripe includes.
export async function exchangeStripeOAuthCode(secretKey: string, code: string, mode: 'test' | 'live', fetcher = fetch) {
  const response = await fetcher('https://connect.stripe.com/oauth/token', {
    method: 'POST', headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code }), signal: AbortSignal.timeout(20000),
  })
  const result = await response.json()
  if (!response.ok || result.scope !== 'read_write' || result.livemode !== (mode === 'live') || !/^acct_[a-zA-Z0-9]+$/.test(result.stripe_user_id ?? '')) {
    throw new Error('Konto ühendamine ei õnnestunud. Alusta ühendamist uuesti.')
  }
  return result.stripe_user_id as string
}

export async function revokeStripeOAuthAccount(secretKey: string, clientId: string, accountId: string, fetcher = fetch) {
  if (!/^ca_[a-zA-Z0-9]+$/.test(clientId) || !/^acct_[a-zA-Z0-9]+$/.test(accountId)) throw new Error('Stripe’i ühenduse eemaldamine pole seadistatud.')
  const response = await fetcher('https://connect.stripe.com/oauth/deauthorize', {
    method: 'POST', headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, stripe_user_id: accountId }), signal: AbortSignal.timeout(20000),
  })
  const result = await response.json()
  if (!response.ok || result.stripe_user_id !== accountId) throw new Error('Stripe’i ühenduse eemaldamine ei õnnestunud.')
}
