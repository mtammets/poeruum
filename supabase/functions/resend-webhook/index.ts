import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const deliveryStatus: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.failed': 'failed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}

const cleanReply = (value: string) => value
  .replace(/\r/g, '')
  .split(/\nOn .+wrote:\s*\n/i)[0]
  .split(/\n-{2,}\s*Original Message\s*-{2,}/i)[0]
  .split(/\n-{2,}\s*Algne sõnum\s*-{2,}/i)[0]
  .split('\n>')[0]
  .trim()
  .slice(0, 10000)

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const payload = await request.text()
    const resend = new Resend(requiredEnv('RESEND_API_KEY'))
    const event = resend.webhooks.verify({
      payload,
      headers: {
        id: request.headers.get('svix-id') ?? '',
        timestamp: request.headers.get('svix-timestamp') ?? '',
        signature: request.headers.get('svix-signature') ?? '',
      },
      webhookSecret: requiredEnv('RESEND_WEBHOOK_SECRET'),
    }) as { type: string; created_at?: string; data: Record<string, unknown> }

    const eventId = request.headers.get('svix-id') ?? ''
    if (!eventId) return json({ error: 'Invalid webhook' }, 400)
    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: receiptError } = await admin.from('resend_webhook_events').insert({ id: eventId, event_type: event.type })
    if (receiptError?.code === '23505') return json({ ok: true, duplicate: true })
    if (receiptError) throw receiptError

    const emailId = String(event.data.email_id ?? '')
    if (deliveryStatus[event.type] && emailId) {
      const recipients = Array.isArray(event.data.to) ? event.data.to.map(String) : []
      const rawTags = event.data.tags
      const tags = Array.isArray(rawTags)
        ? Object.fromEntries(rawTags.map((tag) => [String(tag?.name ?? ''), String(tag?.value ?? '')]))
        : (rawTags && typeof rawTags === 'object' ? rawTags as Record<string, unknown> : {})
      if (recipients[0]) {
        const { error: deliveryError } = await admin.from('email_deliveries').upsert({
          resend_email_id: emailId,
          recipient_email: recipients[0].toLowerCase(),
          subject: String(event.data.subject ?? ''),
          email_type: tags.email_type ? String(tags.email_type) : null,
          status: deliveryStatus[event.type],
          sent_at: String(event.data.created_at ?? event.created_at ?? new Date().toISOString()),
          status_updated_at: event.created_at ?? new Date().toISOString(),
        }, { onConflict: 'resend_email_id' })
        if (deliveryError) throw deliveryError
      }
      const { error } = await admin.from('support_messages').update({
        delivery_status: deliveryStatus[event.type],
        delivery_updated_at: event.created_at ?? new Date().toISOString(),
      }).eq('resend_email_id', emailId)
      if (error) throw error
      return json({ ok: true })
    }

    if (event.type === 'email.received' && emailId) {
      const recipients = Array.isArray(event.data.to) ? event.data.to.map(String) : []
      const target = recipients.find((address) => /vastus\+[0-9a-f-]{36}@/i.test(address)) ?? ''
      const conversationId = target.match(/vastus\+([0-9a-f-]{36})@/i)?.[1]
      if (!conversationId) return json({ ok: true, ignored: 'No conversation id' })

      const { data: conversation } = await admin.from('support_conversations').select('id,user_id').eq('id', conversationId).maybeSingle()
      if (!conversation) return json({ ok: true, ignored: 'Unknown conversation' })
      const sender = String(event.data.from ?? '').trim().toLowerCase()
      const { data: owner } = await admin.auth.admin.getUserById(conversation.user_id)
      if (!owner.user?.email || owner.user.email.toLowerCase() !== sender) return json({ ok: true, ignored: 'Sender mismatch' })

      const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
        headers: { Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`, 'User-Agent': 'poeruum-support-webhook/1.0' },
      })
      if (!response.ok) throw new Error(`Received email fetch failed (${response.status}).`)
      const received = await response.json() as { text?: string | null; html?: string | null; message_id?: string | null }
      const body = cleanReply(received.text || String(received.html ?? '').replace(/<[^>]+>/g, ' '))
      if (!body) return json({ ok: true, ignored: 'Empty reply' })
      const { error } = await admin.from('support_messages').insert({
        conversation_id: conversation.id,
        sender_kind: 'user',
        sender_user_id: conversation.user_id,
        body,
        source: 'email',
        inbound_message_id: received.message_id || emailId,
      })
      if (error?.code !== '23505' && error) throw error
      return json({ ok: true })
    }

    return json({ ok: true, ignored: event.type })
  } catch (error) {
    console.error(error)
    return json({ error: 'Invalid webhook' }, 400)
  }
})
