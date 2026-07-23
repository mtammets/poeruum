import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@^22'
import { assertStripeMode } from './stripe-mode.ts'

export type WebhookSource = 'account' | 'connect'

const cryptoProvider = Stripe.createSubtleCryptoProvider()

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

export const getAdminClient = () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('POERUUM_SUPABASE_SECRET_KEY')
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase serveri keskkonnamuutujad puuduvad.')
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export const verifyStripeEvent = async (request: Request, webhookSecretName: string) => {
  const apiKey = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get(webhookSecretName)
  const signature = request.headers.get('stripe-signature')
  if (!apiKey || !webhookSecret) throw new Error(`Puudub ${!apiKey ? 'STRIPE_SECRET_KEY' : webhookSecretName}.`)
  if (!signature) throw new Error('Stripe-Signature päis puudub.')

  const stripeMode = assertStripeMode(apiKey)
  const stripe = new Stripe(apiKey)
  const body = await request.text()
  const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider)
  if (event.livemode !== (stripeMode === 'live')) throw new Error('Webhooki sündmus on vales Stripe’i režiimis.')
  return event
}

export const claimEvent = async (event: Stripe.Event, source: WebhookSource) => {
  const admin = getAdminClient()
  const accountId = typeof event.account === 'string' ? event.account : null
  const { error } = await admin.from('stripe_webhook_events').insert({
    event_id: event.id,
    source,
    event_type: event.type,
    livemode: event.livemode,
    connected_account_id: accountId,
  })
  if (!error) return true
  if (error.code === '23505') return false
  throw error
}

export const completeEvent = async (eventId: string) => {
  const { error } = await getAdminClient().from('stripe_webhook_events').update({ processed_at: new Date().toISOString() }).eq('event_id', eventId)
  if (error) throw error
}

export const releaseEvent = async (eventId: string) => {
  const { error } = await getAdminClient().from('stripe_webhook_events').delete().eq('event_id', eventId)
  if (error) console.error('Webhooki sündmuse vabastamine ebaõnnestus.', error)
}

export const stripeId = (value: unknown) => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return null
}

export const metadataStoreId = (value: unknown) => {
  if (!value || typeof value !== 'object' || !('metadata' in value)) return null
  const metadata = value.metadata
  if (!metadata || typeof metadata !== 'object' || !('store_id' in metadata) || typeof metadata.store_id !== 'string') return null
  return metadata.store_id
}
