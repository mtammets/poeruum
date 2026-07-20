import type Stripe from 'npm:stripe@^22'
import {
  claimEvent,
  completeEvent,
  getAdminClient,
  json,
  releaseEvent,
  verifyStripeEvent,
} from '../_shared/stripe-webhook.ts'

const handleEvent = async (event: Stripe.Event) => {
  const admin = getAdminClient()

  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account
    const isReady = account.charges_enabled && account.payouts_enabled
    const { error } = await admin.from('stores').update({
      payment_provider: 'stripe',
      payment_status: isReady ? 'connected' : 'pending',
      stripe_account_charges_enabled: account.charges_enabled,
      stripe_account_payouts_enabled: account.payouts_enabled,
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
      stripe_account_charges_enabled: false,
      stripe_account_payouts_enabled: false,
    }).eq('stripe_account_id', connectedAccountId)
    if (error) throw error
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let event: Stripe.Event
  try {
    event = await verifyStripeEvent(request, 'STRIPE_CONNECT_WEBHOOK_SECRET')
  } catch (error) {
    console.error('Stripe Connect webhooki kontroll ebaõnnestus.', error)
    return json({ error: 'Invalid Stripe signature' }, 400)
  }

  try {
    if (!await claimEvent(event, 'connect')) return json({ received: true, duplicate: true })
    await handleEvent(event)
    await completeEvent(event.id)
    return json({ received: true })
  } catch (error) {
    await releaseEvent(event.id)
    console.error(`Stripe Connect webhook ${event.id} ebaõnnestus.`, error)
    return json({ error: 'Webhook processing failed' }, 500)
  }
})
