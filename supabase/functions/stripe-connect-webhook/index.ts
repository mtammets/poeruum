import Stripe from 'npm:stripe@^22'
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

  if (event.type === 'account.updated') {
    const eventAccount = event.data.object as Stripe.Account
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')?.trim()
    if (!stripeSecretKey) throw new Error('Puudub STRIPE_SECRET_KEY.')
    const retrievedAccount = await new Stripe(stripeSecretKey).accounts.retrieve(eventAccount.id)
    if ('deleted' in retrievedAccount && retrievedAccount.deleted) return
    const account = retrievedAccount
    const isReady = account.charges_enabled && account.payouts_enabled
    const requirements = summarizeStripeRequirements(account)
    const { error } = await admin.from('stores').update({
      payment_provider: 'stripe',
      stripe_account_mode: event.livemode ? 'live' : 'test',
      payment_status: isReady ? 'connected' : 'pending',
      stripe_account_charges_enabled: account.charges_enabled,
      stripe_account_payouts_enabled: account.payouts_enabled,
      ...stripeRequirementStoreUpdate(requirements),
    }).eq('stripe_account_id', account.id)
    if (error) throw error
    return
  }

  if (event.type === 'account.application.deauthorized') {
    const connectedAccountId = typeof event.account === 'string' ? event.account : null
    if (!connectedAccountId) return
    const { error } = await admin.from('stores').update({
      payment_status: 'idle',
      stripe_account_id: null,
      stripe_account_mode: null,
      stripe_account_charges_enabled: false,
      stripe_account_payouts_enabled: false,
      ...emptyStripeRequirementStoreUpdate(),
    }).eq('stripe_account_id', connectedAccountId)
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

  try {
    if (!await claimEvent(event, 'connect')) return json({ received: true, duplicate: true })
    await handleEvent(event)
    await completeEvent(event.id)
    return json({ received: true })
  } catch (error) {
    await releaseEvent(event.id)
    await captureEdgeError('stripe-connect-webhook', error, { event_type: event.type }, 'critical')
    console.error(`Stripe Connect webhook ${event.id} ebaõnnestus.`, error)
    return json({ error: 'Webhook processing failed' }, 500)
  }
})
