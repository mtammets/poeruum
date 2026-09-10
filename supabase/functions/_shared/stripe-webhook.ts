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

export const verifyStripeEvent = async (
  request: Request,
  webhookSecretName: string,
  options: { allowModeMismatch?: boolean } = {},
) => {
  const apiKey = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get(webhookSecretName)
  const signature = request.headers.get('stripe-signature')
  if (!apiKey || !webhookSecret) throw new Error(`Puudub ${!apiKey ? 'STRIPE_SECRET_KEY' : webhookSecretName}.`)
  if (!signature) throw new Error('Stripe-Signature päis puudub.')

  const stripeMode = assertStripeMode(apiKey)
  const stripe = new Stripe(apiKey)
  const body = await request.text()
  const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider)
  if (!options.allowModeMismatch && event.livemode !== (stripeMode === 'live')) {
    throw new Error('Webhooki sündmus on vales Stripe’i režiimis.')
  }
  return event
}

export const claimEvent = async (event: Stripe.Event, source: WebhookSource) => {
  const { data, error } = await getAdminClient().rpc('claim_stripe_webhook', {
    event_id_value: event.id, source_value: source, event_type_value: event.type,
    livemode_value: event.livemode, connected_account_value: event.account ?? null, payload_value: event,
  })
  if (error) throw error
  if (!data || !['claimed', 'processed', 'busy'].includes(data.state) || (data.state === 'claimed' && !data.token)) {
    throw new Error('Webhooki tööõigus puudub.')
  }
  return data as { state: 'claimed' | 'processed' | 'busy'; token?: string }
}

export const finishEvent = async (eventId: string, token: string, outcome: 'completed' | 'retry' | 'needs_review', message: string | null = null) => {
  const { error } = await getAdminClient().rpc('finish_stripe_webhook', {
    event_id_value: eventId, token_value: token, outcome_value: outcome, error_value: message,
  })
  if (error) throw error
}

export const completeEvent = (eventId: string, token: string) => finishEvent(eventId, token, 'completed')

export const releaseEvent = async (eventId: string, token: string, error: unknown) => {
  try { await finishEvent(eventId, token, 'retry', error instanceof Error ? error.message : 'Webhooki töötlemine katkes.') }
  catch (saveError) { console.error('Webhooki korduskatse salvestamine ebaõnnestus.', saveError) }
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
