import Stripe from 'npm:stripe@^22'
import { syncSellerPaymentCheck } from '../_shared/seller-payment-check.ts'
import { captureEdgeError } from '../_shared/security.ts'
import {
  claimEvent,
  completeEvent,
  getAdminClient,
  json,
  releaseEvent,
  verifyStripeEvent,
} from '../_shared/stripe-webhook.ts'
import {
  emptyStripeRequirementStoreUpdate,
  stripeRequirementStoreUpdate,
  summarizeStripeRequirements,
} from '../_shared/stripe-connect-requirements.ts'

const handleEvent = async (event: Stripe.Event) => {
  const admin = getAdminClient()

  if (event.type === 'account.updated' || event.type.startsWith('account.external_account.')) {
    const accountId = event.type === 'account.updated' ? (event.data.object as Stripe.Account).id : event.account
    if (!accountId) return
    const { data: stores, error: storesError } = await admin.from('stores').select('id,settings,stripe_connection_type,stripe_account_id,stripe_account_mode')
      .eq('stripe_account_id', accountId).eq('stripe_account_mode', event.livemode ? 'live' : 'test')
    if (storesError) throw storesError
    if (!stores?.length) return
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')?.trim()
    if (!stripeSecretKey) throw new Error('Puudub STRIPE_SECRET_KEY.')
    const stripe = new Stripe(stripeSecretKey)
    const retrievedAccount = await stripe.accounts.retrieve(accountId)
    if ('deleted' in retrievedAccount && retrievedAccount.deleted) return
    const account = retrievedAccount
    const requirements = summarizeStripeRequirements(account)
    for (const store of stores ?? []) {
      await syncSellerPaymentCheck(admin, stripe, store, account)
      const { error } = await admin.from('stores').update({
        payment_provider: 'stripe',
        stripe_account_mode: event.livemode ? 'live' : 'test',
        stripe_account_charges_enabled: account.charges_enabled,
        stripe_account_payouts_enabled: account.payouts_enabled,
        ...stripeRequirementStoreUpdate(requirements),
      }).eq('id', store.id).eq('stripe_account_id', account.id)
      if (error) throw error
    }
    return
  }

  if (event.type === 'account.application.deauthorized') {
    const connectedAccountId = typeof event.account === 'string' ? event.account : null
    if (!connectedAccountId) return
    const { error } = await admin.from('stores').update({
      payment_status: 'idle',
      stripe_account_id: null,
      stripe_account_mode: null,
      stripe_connection_type: null,
      stripe_account_charges_enabled: false,
      stripe_account_payouts_enabled: false,
      ...emptyStripeRequirementStoreUpdate(),
    }).eq('stripe_account_id', connectedAccountId).eq('stripe_account_mode', event.livemode ? 'live' : 'test')
    if (error) throw error
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let event: Stripe.Event
  try {
    // A live Connect endpoint can also receive connected-account test events.
    // Their signature is valid, but the live deployment must acknowledge and
    // ignore them instead of trying to retrieve a test account with a live key.
    event = await verifyStripeEvent(request, 'STRIPE_CONNECT_WEBHOOK_SECRET', { allowModeMismatch: true })
  } catch (error) {
    console.error('Stripe Connect webhooki kontroll ebaõnnestus.', error)
    return json({ error: 'Invalid Stripe signature' }, 400)
  }

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')?.trim() ?? ''
  const expectsLiveEvents = stripeSecretKey.startsWith('sk_live_')
  if (event.livemode !== expectsLiveEvents) return json({ received: true, ignoredMode: true })

  let token: string | undefined
  try {
    const claim = await claimEvent(event, 'connect')
    if (claim.state === 'processed') return json({ received: true, duplicate: true })
    if (claim.state === 'busy') return json({ error: 'Webhook processing in progress' }, 503)
    token = claim.token!
    await handleEvent(event)
    await completeEvent(event.id, token)
    return json({ received: true })
  } catch (error) {
    if (token) await releaseEvent(event.id, token, error)
    await captureEdgeError('stripe-connect-webhook', error, { event_type: event.type }, 'critical')
    console.error(`Stripe Connect webhook ${event.id} ebaõnnestus.`, error)
    return json({ error: 'Webhook processing failed' }, 500)
  }
})
