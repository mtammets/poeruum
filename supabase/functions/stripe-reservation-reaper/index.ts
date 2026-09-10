import Stripe from 'npm:stripe@^22'
import { captureEdgeError } from '../_shared/security.ts'
import { assertStripeMode } from '../_shared/stripe-mode.ts'
import { finishEvent, getAdminClient, json } from '../_shared/stripe-webhook.ts'
import { handleStorePaymentEvent, isStorePaymentEvent } from '../_shared/stripe-store-events.ts'
import { PaymentReviewRequired, recoverOrderPayment, recoveryRpc, type RecoveryJob } from '../_shared/payment-recovery.ts'

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const cronSecret = Deno.env.get('ONBOARDING_CRON_SECRET')?.trim()
  if (!cronSecret || request.headers.get('Authorization') !== `Bearer ${cronSecret}`) return json({ error: 'Unauthorized' }, 401)
  if (Deno.env.get('PAYMENT_RECOVERY_WORKER_ENABLED') !== 'true') return json({ skipped: true })
  const outcomes: Record<string, number> = {}
  const count = (key: string) => { outcomes[key] = (outcomes[key] ?? 0) + 1 }
  try {
    const key = requiredEnv('STRIPE_SECRET_KEY')
    const mode = assertStripeMode(key)
    const admin = getAdminClient()
    const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient(), timeout: 10_000, maxNetworkRetries: 1 })
    const deadline = Date.now() + 50_000
    // Alternate queues so a burst of old events cannot starve order recovery.
    for (let index = 0; index < 10 && Date.now() < deadline; index++) {
      const [job] = await recoveryRpc(admin, 'claim_order_payment_recovery', { mode_value: mode }) as RecoveryJob[]
      if (job) {
        try { count(`order_${await recoverOrderPayment({ admin, stripe, mode }, job)}`) }
        catch (error) {
          count('order_save_failed')
          await captureEdgeError('stripe-reservation-reaper', error, { order_id: job.order_id }, 'critical')
          // Its lease will expire; another worker resumes without losing the job.
        }
      }
      if (Date.now() >= deadline) break
      const [stored] = await recoveryRpc(admin, 'claim_stored_stripe_webhook', { mode_value: mode })
      if (stored) {
        let outcome: 'completed' | 'retry' | 'needs_review' = 'retry'
        let message: string | null = null
        try {
          let event: Stripe.Event
          if (stored.payload) event = stored.payload
          else {
            try { event = await stripe.events.retrieve(stored.event_id) }
            catch (error) {
              if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) {
                throw new PaymentReviewRequired('Vana sündmus pole Stripe’ist enam loetav; tellimust kontrollitakse eraldi.')
              }
              throw error
            }
          }
          if (event.id !== stored.event_id || event.type !== stored.event_type || event.livemode !== (mode === 'live')
            || (event.account ?? null) !== stored.connected_account_id) throw new PaymentReviewRequired('Salvestatud sündmuse andmed ei ühti.')
          if (!isStorePaymentEvent(event)) throw new PaymentReviewRequired('See sündmus vajab eraldi arvelduse kontrolli.')
          await handleStorePaymentEvent(event, false)
          outcome = 'completed'
        } catch (error) {
          outcome = error instanceof PaymentReviewRequired ? 'needs_review' : 'retry'
          message = error instanceof Error ? error.message : 'Sündmuse taastamine ebaõnnestus.'
        }
        try { await finishEvent(stored.event_id, stored.lease_token, outcome, message); count(`event_${outcome}`) }
        catch (error) {
          count('event_save_failed')
          await captureEdgeError('stripe-reservation-reaper', error, { event_id: stored.event_id }, 'critical')
        }
      }
      if (!job && !stored) break
    }
    return json({ outcomes })
  } catch (error) {
    await captureEdgeError('stripe-reservation-reaper', error, {}, 'critical')
    return json({ error: 'Payment recovery failed', outcomes }, 500)
  }
})
