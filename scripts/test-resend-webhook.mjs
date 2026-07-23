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
const adminKey = process.env.SUPABASE_SECRET_KEY?.trim() || required('SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(required('VITE_SUPABASE_URL'), adminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
})
const before = new Date().toISOString()
const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${required('RESEND_API_KEY')}`,
    'Content-Type': 'application/json',
    'User-Agent': 'poeruum-support-test/1.0',
  },
  body: JSON.stringify({
    from: 'Poeruum <teavitused@send.poeruum.ee>',
    to: ['delivered@resend.dev'],
    subject: 'Poeruumi webhooki test',
    text: 'Automaatne tehniline test.',
    tags: [{ name: 'email_type', value: 'support_webhook_test' }],
  }),
})
if (!response.ok) throw new Error(`Testkirja saatmine ebaõnnestus (${response.status}).`)
const sentEmail = await response.json()

for (let attempt = 0; attempt < 12; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const { data, error } = await supabase.from('resend_webhook_events').select('event_type').gte('processed_at', before)
  if (error) throw error
  const eventTypes = [...new Set((data ?? []).map((item) => item.event_type))]
  if (eventTypes.includes('email.delivered')) {
    const { data: delivery, error: deliveryError } = await supabase.from('email_deliveries')
      .select('status').eq('resend_email_id', sentEmail.id).maybeSingle()
    if (deliveryError) throw deliveryError
    if (delivery?.status === 'delivered') {
      console.log(`Webhook ja kirjajalugu töötavad: ${eventTypes.join(', ')}`)
      process.exit(0)
    }
  }
}
throw new Error('Resendi webhook ei salvestanud kohaletoimetamise sündmust 12 sekundi jooksul.')
