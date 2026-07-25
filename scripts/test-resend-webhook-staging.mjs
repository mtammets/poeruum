import crypto from 'node:crypto'
import process from 'node:process'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

config({ path: '.env', quiet: true })

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const supabaseUrl = required('VITE_SUPABASE_URL')
const adminKey = process.env.SUPABASE_SECRET_KEY?.trim() || required('SUPABASE_SERVICE_ROLE_KEY')
const webhookSecret = required('RESEND_WEBHOOK_SECRET')
const secretBytes = Buffer.from(webhookSecret.replace(/^whsec_/, ''), 'base64')
const supabase = createClient(supabaseUrl, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
})
const suffix = `${Date.now()}-${crypto.randomUUID()}`
const eventId = `msg_${suffix}`
const emailId = `resend-staging-${suffix}`
const timestamp = Math.floor(Date.now() / 1000)
const event = {
  type: 'email.delivered',
  created_at: new Date().toISOString(),
  data: {
    email_id: emailId,
    created_at: new Date().toISOString(),
    from: 'Poeruum <teavitused@send.poeruum.ee>',
    to: ['delivered@resend.dev'],
    subject: 'Poeruumi staging webhooki test',
    tags: [{ name: 'email_type', value: 'support_webhook_staging_test' }],
  },
}
const payload = JSON.stringify(event)
const signature = crypto.createHmac('sha256', secretBytes)
  .update(`${eventId}.${timestamp}.${payload}`)
  .digest('base64')

try {
  const response = await fetch(`${supabaseUrl}/functions/v1/resend-webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': eventId,
      'svix-timestamp': String(timestamp),
      'svix-signature': `v1,${signature}`,
    },
    body: payload,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result?.ok !== true) {
    throw new Error(`Resendi staging webhook vastas ${response.status}: ${JSON.stringify(result)}`)
  }

  const { data: receipt, error: receiptError } = await supabase.from('resend_webhook_events')
    .select('event_type')
    .eq('id', eventId)
    .maybeSingle()
  if (receiptError) throw receiptError
  if (receipt?.event_type !== 'email.delivered') throw new Error('Webhooki sündmust ei salvestatud.')

  const { data: delivery, error: deliveryError } = await supabase.from('email_deliveries')
    .select('status,email_type')
    .eq('resend_email_id', emailId)
    .maybeSingle()
  if (deliveryError) throw deliveryError
  if (delivery?.status !== 'delivered' || delivery.email_type !== 'support_webhook_staging_test') {
    throw new Error(`Kirja kohaletoimetamise olek on vale: ${JSON.stringify(delivery)}`)
  }
  console.log('Resendi allkirjakontroll, webhooki sündmus ja kirjajalugu töötavad staging’us.')
} finally {
  await supabase.from('email_deliveries').delete().eq('resend_email_id', emailId)
  await supabase.from('resend_webhook_events').delete().eq('id', eventId)
}
