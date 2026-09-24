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
const foreignEventId = `${eventId}-foreign`
const foreignEmailId = `${emailId}-foreign`
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
    .select('status,email_type,sender_email,source_application')
    .eq('resend_email_id', emailId)
    .maybeSingle()
  if (deliveryError) throw deliveryError
  if (delivery?.status !== 'delivered' || delivery.email_type !== 'support_webhook_staging_test'
    || delivery.sender_email !== 'teavitused@send.poeruum.ee' || delivery.source_application !== 'poeruum') {
    throw new Error(`Kirja kohaletoimetamise olek on vale: ${JSON.stringify(delivery)}`)
  }
  const foreignPayload = JSON.stringify({ ...event, data: { ...event.data, email_id: foreignEmailId, from: 'Other app <notice@example.invalid>' } })
  const foreignSignature = crypto.createHmac('sha256', secretBytes)
    .update(`${foreignEventId}.${timestamp}.${foreignPayload}`).digest('base64')
  const foreignResponse = await fetch(`${supabaseUrl}/functions/v1/resend-webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'svix-id': foreignEventId,
      'svix-timestamp': String(timestamp), 'svix-signature': `v1,${foreignSignature}`,
    },
    body: foreignPayload,
  })
  const foreignResult = await foreignResponse.json()
  if (!foreignResponse.ok || foreignResult.ok !== true || !foreignResult.ignored) {
    throw new Error('Teise rakenduse saatmisteadet ei ignoreeritud.')
  }
  for (const [table, column, id] of [
    ['email_deliveries', 'resend_email_id', foreignEmailId],
    ['resend_webhook_events', 'id', foreignEventId],
  ]) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq(column, id)
    if (error) throw error
    if (count !== 0) throw new Error(`Võõras kiri salvestati tabelisse ${table}.`)
  }
  console.log('Resendi allkirjakontroll, Poeruumi kirjajalugu ja võõraste saatmisteadete eraldamine töötavad.')
} finally {
  await supabase.from('email_deliveries').delete().in('resend_email_id', [emailId, foreignEmailId])
  await supabase.from('resend_webhook_events').delete().in('id', [eventId, foreignEventId])
}
