import { stripeSellerIdentityError } from './stripe-oauth.ts'
import { sellerType } from '../../../shared/seller.ts'
import { getStripePrefill, type PoeruumStore } from './stripe-connect-prefill.ts'

export const STRIPE_RETURN_PATH = '/stripe/connect/return'

export function dedicatedStripeAccountParams(store: PoeruumStore, ownerId: string, email: string) {
  const { business_type, business_profile } = getStripePrefill(store, email)
  return {
    country: 'EE', email, business_type, business_profile,
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    // Stripe collects identity information and can reuse an authenticated
    // seller's existing legal entity. Express preserves our fee/loss model.
    // Do not create a Person beforehand: that can prevent legal entity reuse.
    controller: {
      fees: { payer: 'application' as const }, losses: { payments: 'application' as const },
      requirement_collection: 'stripe' as const, stripe_dashboard: { type: 'express' as const },
    },
    metadata: { poeruum_store_id: store.id, poeruum_owner_id: ownerId, seller_type: sellerType(store.settings ?? {}), poeruum_connection: 'dedicated' },
  }
}

type HostedAccount = {
  country?: string; business_type?: string | null
  individual?: { first_name?: string | null; last_name?: string | null } | null
  company?: { name?: string | null; registration_number?: string | null } | null
  controller?: { requirement_collection?: string; stripe_dashboard?: { type?: string } }
  metadata?: Record<string, string> | null
}

export function isDedicatedStripeAccount(account: HostedAccount, storeId: string) {
  return account.controller?.requirement_collection === 'stripe'
    && account.controller?.stripe_dashboard?.type === 'express'
    && account.metadata?.poeruum_store_id === storeId
    && account.metadata?.poeruum_connection === 'dedicated'
}

export function hostedSellerError(account: HostedAccount, settings: Record<string, unknown>) {
  return stripeSellerIdentityError(account, settings)
}

export function stripeReturnOrigin(requested: string | undefined, configured: string, mode: 'test' | 'live', storeSlug: string, customHostname?: string) {
  const app = new URL(configured)
  const url = new URL(requested || app.origin)
  const root = app.hostname.replace(/^(www|app)\./, '')
  const allowed = url.origin === app.origin || (url.protocol === 'https:'
    && (url.hostname === `${storeSlug}.${root}` || url.hostname === customHostname))
  const safeProtocol = url.protocol === 'https:' || (mode === 'test' && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
  if (!allowed || !safeProtocol || url.username || url.password || url.port !== app.port && url.port !== '') throw new Error('Tagasisuunamise aadress ei sobi.')
  return url.origin
}

export function stripeHostedLinkParams(accountId: string, origin: string) {
  return {
    account: accountId, type: 'account_onboarding' as const,
    return_url: `${origin}${STRIPE_RETURN_PATH}`,
    refresh_url: `${origin}${STRIPE_RETURN_PATH}?refresh=1`,
    collection_options: { fields: 'eventually_due' as const },
  }
}
