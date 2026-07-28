import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@^6.18.0'
import { captureEdgeError } from '../_shared/security.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const createAdminClient = () => createClient(
  requiredEnv('SUPABASE_URL'),
  requiredEnv('POERUUM_SUPABASE_SECRET_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
)

type AdminClient = ReturnType<typeof createAdminClient>

const deliveryStatus: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.failed': 'failed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}

type ReceivedAttachment = {
  id: string
  filename?: string | null
  content_type?: string | null
  content_disposition?: string | null
  size?: number | null
}

type ReceivedEmail = {
  from?: string | null
  subject?: string | null
  text?: string | null
  html?: string | null
  message_id?: string | null
  headers?: Record<string, string> | null
  attachments?: ReceivedAttachment[] | null
}

type SupportConversation = {
  id: string
  user_id: string | null
  origin: 'app' | 'email'
  external_email: string | null
}

type SalesLeadDelivery = {
  id: string
  contact_email: string | null
}

type ResendWebhookEvent = {
  type: string
  created_at?: string
  data: Record<string, unknown>
}

const normalizeEmail = (value: unknown) => {
  const raw = String(value ?? '').trim().toLowerCase()
  return raw.match(/<([^<>\s@]+@[^<>\s@]+)>/)?.[1] || raw
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const markLeadReply = async (admin: AdminClient, sender: string, receivedAt: string) => {
  const { data, error } = await admin.from('sales_leads')
    .select('id')
    .eq('contact_email', sender)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) return

  const { error: updateError } = await admin.from('sales_leads').update({
    status: 'replied',
    replied_at: receivedAt,
  }).eq('id', data.id).eq('status', 'sent')
  if (updateError) throw updateError
  const { error: eventError } = await admin.from('lead_events').insert({
    lead_id: data.id,
    event_type: 'replied',
    details: { source: 'resend_inbound' },
  })
  if (eventError) throw eventError
}

const displayNameFromHeader = (value: string | undefined, email: string) => {
  const header = String(value ?? '').trim()
  const beforeAddress = header.match(/^(.*?)\s*<[^<>]+>$/)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
  if (!beforeAddress || beforeAddress.toLowerCase() === email) return null
  return beforeAddress.slice(0, 160)
}

const htmlToText = (value: string) => value
  .replace(/<\s*br\s*\/?>/gi, '\n')
  .replace(/<\s*\/p\s*>/gi, '\n\n')
  .replace(/<[^>]+>/g, ' ')
  .replaceAll('&nbsp;', ' ')
  .replaceAll('&amp;', '&')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")

const cleanReply = (value: string) => value
  .replace(/\r/g, '')
  .split(/\nOn .+wrote:\s*\n/i)[0]
  .split(/\n-{2,}\s*Original Message\s*-{2,}/i)[0]
  .split(/\n-{2,}\s*Algne sõnum\s*-{2,}/i)[0]
  .split('\n>')[0]
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, 10000)

const safeFilename = (value: string | null | undefined) => {
  const cleaned = String(value || 'manus')
    .normalize('NFKC')
    .replace(/[/\\\p{Cc}]/gu, '_')
    .trim()
    .slice(0, 180)
  return cleaned || 'manus'
}

const allowedAttachmentTypes = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
])
const maxAttachmentSize = 5 * 1024 * 1024

const fetchReceivedEmail = async (emailId: string, apiKey: string) => {
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'poeruum-support-webhook/1.0' },
  })
  if (!response.ok) throw new Error(`Received email fetch failed (${response.status}).`)
  return await response.json() as ReceivedEmail
}

const saveFirstAttachment = async (
  admin: AdminClient,
  received: ReceivedEmail,
  emailId: string,
  conversationId: string,
  apiKey: string,
) => {
  const attachment = (received.attachments ?? []).find((candidate) =>
    candidate.content_disposition !== 'inline'
    && allowedAttachmentTypes.has(String(candidate.content_type ?? '').toLowerCase())
    && (candidate.size == null || candidate.size <= maxAttachmentSize))
  if (!attachment?.id) return null

  const metadataResponse = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachment.id)}`,
    { headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'poeruum-support-webhook/1.0' } },
  )
  if (!metadataResponse.ok) throw new Error(`Received attachment fetch failed (${metadataResponse.status}).`)
  const metadata = await metadataResponse.json() as {
    size?: number
    download_url?: string
    filename?: string | null
    content_type?: string | null
  }
  if (Number(metadata.size ?? 0) > maxAttachmentSize) return null
  if (!metadata.download_url) throw new Error('Received attachment download URL is missing.')

  const fileResponse = await fetch(metadata.download_url)
  if (!fileResponse.ok) throw new Error(`Received attachment download failed (${fileResponse.status}).`)
  const contentType = String(metadata.content_type || attachment.content_type || '').toLowerCase()
  if (!allowedAttachmentTypes.has(contentType)) return null
  const filename = safeFilename(metadata.filename || attachment.filename)
  const rawExtension = filename.includes('.') ? filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') : ''
  const extension = rawExtension ? `.${rawExtension}` : ''
  const path = `external/${conversationId}/${crypto.randomUUID()}${extension}`
  const { error } = await admin.storage.from('support-attachments').upload(path, await fileResponse.arrayBuffer(), {
    contentType,
    upsert: false,
  })
  if (error) throw error
  return { path, filename }
}

const inboundMessageBody = (
  body: string,
  received: ReceivedEmail,
  attachment: { path: string; filename: string } | null,
) => {
  const nonInlineAttachments = (received.attachments ?? []).filter((item) => item.content_disposition !== 'inline')
  const omittedCount = Math.max(0, nonInlineAttachments.length - (attachment ? 1 : 0))
  const attachmentOnly = !body && attachment ? 'Kiri sisaldas manust.' : body
  if (!omittedCount) return attachmentOnly
  const note = omittedCount === 1
    ? 'Märkus: üht manust ei salvestatud, sest selle tüüp või suurus ei olnud lubatud.'
    : `Märkus: ${omittedCount} manust ei salvestatud, sest nende tüüp või suurus ei olnud lubatud.`
  return `${attachmentOnly.slice(0, 10000 - note.length - 2)}${attachmentOnly ? '\n\n' : ''}${note}`
}

const sendNewConversationNotification = async (input: {
  apiKey: string
  sender: string
  subject: string
  body: string
  conversationId: string
}) => {
  const notificationEmail = Deno.env.get('SUPPORT_NOTIFICATION_EMAIL')?.trim()
  if (!notificationEmail || normalizeEmail(notificationEmail) === input.sender) return
  const from = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'Poeruum <teavitused@send.poeruum.ee>'
  const publicSupportEmail = normalizeEmail(Deno.env.get('SUPPORT_PUBLIC_EMAIL') || 'info@poeruum.ee')
  const appUrl = (Deno.env.get('APP_URL')?.trim() || 'https://poeruum.ee').replace(/\/$/, '')
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `support-notification-${input.conversationId}`,
        'User-Agent': 'poeruum-support-webhook/1.0',
      },
      body: JSON.stringify({
        from,
        to: [notificationEmail],
        subject: `Uus kiri aadressil ${publicSupportEmail}: ${input.subject}`,
        text: `${input.sender}\n${input.subject}\n\n${input.body}\n\n${appUrl}/admin#klienditugi`,
        tags: [
          { name: 'email_type', value: 'support_notification' },
          { name: 'conversation_id', value: input.conversationId },
        ],
      }),
    })
    if (!response.ok) console.error(`Support notification failed (${response.status}).`)
  } catch (error) {
    console.error('Support notification failed.', error)
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const eventId = request.headers.get('svix-id') ?? ''
  if (!eventId) return json({ error: 'Invalid webhook' }, 400)

  let event: ResendWebhookEvent
  try {
    const payload = await request.text()
    const apiKey = requiredEnv('RESEND_API_KEY')
    const resend = new Resend(apiKey)
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: eventId,
        timestamp: request.headers.get('svix-timestamp') ?? '',
        signature: request.headers.get('svix-signature') ?? '',
      },
      webhookSecret: requiredEnv('RESEND_WEBHOOK_SECRET'),
    }) as unknown as ResendWebhookEvent
  } catch (error) {
    console.error('Resendi webhooki kontroll ebaõnnestus.', error)
    return json({ error: 'Invalid webhook' }, 400)
  }

  let receiptAdmin: AdminClient | null = null
  let receiptStored = false
  try {
    const apiKey = requiredEnv('RESEND_API_KEY')
    const admin = createAdminClient()
    receiptAdmin = admin
    const { error: receiptError } = await admin.from('resend_webhook_events').insert({ id: eventId, event_type: event.type })
    if (receiptError?.code === '23505') return json({ ok: true, duplicate: true })
    if (receiptError) throw receiptError
    receiptStored = true

    const emailId = String(event.data.email_id ?? '')
    if (deliveryStatus[event.type] && emailId) {
      const recipients = Array.isArray(event.data.to) ? event.data.to.map(String) : []
      const rawTags = event.data.tags
      const tags = Array.isArray(rawTags)
        ? Object.fromEntries(rawTags.map((tag) => [String(tag?.name ?? ''), String(tag?.value ?? '')]))
        : (rawTags && typeof rawTags === 'object' ? rawTags as Record<string, unknown> : {})
      const status = deliveryStatus[event.type]
      if (recipients[0]) {
        const { error: deliveryError } = await admin.from('email_deliveries').upsert({
          resend_email_id: emailId,
          recipient_email: recipients[0].toLowerCase(),
          subject: String(event.data.subject ?? ''),
          email_type: tags.email_type ? String(tags.email_type) : null,
          status,
          sent_at: String(event.data.created_at ?? event.created_at ?? new Date().toISOString()),
          status_updated_at: event.created_at ?? new Date().toISOString(),
        }, { onConflict: 'resend_email_id' })
        if (deliveryError) throw deliveryError
      }
      if (String(tags.email_type ?? '') === 'lead_outreach') {
        const taggedLeadId = String(tags.lead_id ?? '')
        let leadQuery = admin.from('sales_leads').select('id,contact_email')
        leadQuery = uuidPattern.test(taggedLeadId)
          ? leadQuery.eq('id', taggedLeadId)
          : leadQuery.eq('resend_email_id', emailId)
        const { data: leadData, error: leadError } = await leadQuery.maybeSingle()
        if (leadError) throw leadError
        const lead = leadData as SalesLeadDelivery | null
        if (lead) {
          const leadUpdate: Record<string, unknown> = { delivery_status: status }
          if (status === 'bounced' || status === 'complained') {
            leadUpdate.status = status
            leadUpdate.suppressed_at = event.created_at ?? new Date().toISOString()
            leadUpdate.suppression_reason = status
          }
          const { error: leadUpdateError } = await admin.from('sales_leads').update(leadUpdate).eq('id', lead.id)
          if (leadUpdateError) throw leadUpdateError

          const contactEmail = normalizeEmail(lead.contact_email || recipients[0])
          if ((status === 'bounced' || status === 'complained') && contactEmail) {
            const { error: suppressionError } = await admin.from('lead_suppressions').upsert({
              email: contactEmail,
              reason: status,
              lead_id: lead.id,
              source: 'resend_webhook',
            }, { onConflict: 'email' })
            if (suppressionError) throw suppressionError
          }
          const { error: eventError } = await admin.from('lead_events').insert({
            lead_id: lead.id,
            event_type: `delivery_${status}`,
            details: { resend_email_id: emailId },
          })
          if (eventError) throw eventError
        }
      }
      const { error } = await admin.from('support_messages').update({
        delivery_status: status,
        delivery_updated_at: event.created_at ?? new Date().toISOString(),
      }).eq('resend_email_id', emailId)
      if (error) throw error
      return json({ ok: true })
    }

    if (event.type === 'email.received' && emailId) {
      const recipients = Array.isArray(event.data.to) ? event.data.to.map(normalizeEmail) : []
      const replyTarget = recipients.find((address) => /vastus\+[0-9a-f-]{36}@/i.test(address)) ?? ''
      const conversationId = replyTarget.match(/vastus\+([0-9a-f-]{36})@/i)?.[1]
      const publicSupportEmail = normalizeEmail(Deno.env.get('SUPPORT_PUBLIC_EMAIL') || 'info@poeruum.ee')
      const inboundDomain = Deno.env.get('SUPPORT_INBOUND_DOMAIN')?.trim().replace(/^@/, '') || 'poeruum.ee'
      const inboundAddress = normalizeEmail(Deno.env.get('SUPPORT_INBOUND_ADDRESS') || `info@${inboundDomain}`)
      const isNewPublicEmail = recipients.includes(publicSupportEmail) || recipients.includes(inboundAddress)
      if (!conversationId && !isNewPublicEmail) return json({ ok: true, ignored: 'Unknown recipient' })

      const sender = normalizeEmail(event.data.from)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) return json({ ok: true, ignored: 'Invalid sender' })
      const received = await fetchReceivedEmail(emailId, apiKey)
      const headers = Object.fromEntries(
        Object.entries(received.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]),
      )
      if (
        headers['auto-submitted'] && headers['auto-submitted'].toLowerCase() !== 'no'
        || /^(mailer-daemon|postmaster|no-?reply)@/i.test(sender)
      ) return json({ ok: true, ignored: 'Automated sender' })

      const body = cleanReply(received.text || htmlToText(String(received.html ?? '')))
      // Resendi email ID on usaldusväärne ja konto piires unikaalne. Saatja
      // Message-ID päis ei sobi duplikaadikaitseks, sest välissaatja saab seda
      // ise määrata või korduskasutada.
      const inboundMessageId = emailId

      if (conversationId) {
        const { data: conversationData, error: conversationError } = await admin.from('support_conversations')
          .select('id,user_id,origin,external_email')
          .eq('id', conversationId)
          .maybeSingle()
        if (conversationError) throw conversationError
        const conversation = conversationData as SupportConversation | null
        if (!conversation) return json({ ok: true, ignored: 'Unknown conversation' })

        let expectedSender = normalizeEmail(conversation.external_email)
        if (conversation.origin === 'app' && conversation.user_id) {
          const { data: owner, error: ownerError } = await admin.auth.admin.getUserById(conversation.user_id)
          if (ownerError) throw ownerError
          expectedSender = normalizeEmail(owner.user?.email)
        }
        if (!expectedSender || expectedSender !== sender) return json({ ok: true, ignored: 'Sender mismatch' })

        const attachment = await saveFirstAttachment(admin, received, emailId, conversation.id, apiKey)
        const messageBody = inboundMessageBody(body, received, attachment)
        if (!messageBody) return json({ ok: true, ignored: 'Empty reply' })
        const { error } = await admin.from('support_messages').insert({
          conversation_id: conversation.id,
          sender_kind: 'user',
          sender_user_id: conversation.user_id,
          body: messageBody,
          source: 'email',
          inbound_message_id: inboundMessageId,
          attachment_path: attachment?.path ?? null,
          attachment_name: attachment?.filename ?? null,
        })
        if (error?.code === '23505') {
          if (attachment) await admin.storage.from('support-attachments').remove([attachment.path])
          return json({ ok: true, duplicate: true })
        }
        if (error) {
          if (attachment) await admin.storage.from('support-attachments').remove([attachment.path])
          throw error
        }
        return json({ ok: true })
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const [senderLimit, totalLimit] = await Promise.all([
        admin.from('support_conversations').select('id', { count: 'exact', head: true })
          .eq('origin', 'email').eq('external_email', sender).gte('created_at', oneHourAgo),
        admin.from('support_conversations').select('id', { count: 'exact', head: true })
          .eq('origin', 'email').gte('created_at', oneHourAgo),
      ])
      if (senderLimit.error) throw senderLimit.error
      if (totalLimit.error) throw totalLimit.error
      if ((senderLimit.count ?? 0) >= 10 || (totalLimit.count ?? 0) >= 100) {
        return json({ ok: true, ignored: 'Inbound rate limit' })
      }

      const fallbackSubject = `Kiri aadressile ${publicSupportEmail}`
      const subject = String(received.subject || event.data.subject || fallbackSubject)
        .trim().slice(0, 160) || fallbackSubject
      const contactName = displayNameFromHeader(headers.from, sender)
      const { data: conversation, error: conversationError } = await admin.from('support_conversations').insert({
        user_id: null,
        store_id: null,
        subject,
        category: 'question',
        origin: 'email',
        external_email: sender,
        external_name: contactName,
        page_url: `mailto:${publicSupportEmail}`,
        user_agent: 'Resend Inbound',
      }).select('id').single()
      if (conversationError || !conversation) throw conversationError || new Error('Inbound conversation was not created.')

      let attachment: { path: string; filename: string } | null = null
      try {
        attachment = await saveFirstAttachment(admin, received, emailId, conversation.id, apiKey)
        const messageBody = inboundMessageBody(body, received, attachment)
        if (!messageBody) {
          const { error: deleteError } = await admin.from('support_conversations').delete().eq('id', conversation.id)
          if (deleteError) throw deleteError
          return json({ ok: true, ignored: 'Empty email' })
        }
        const { error: messageError } = await admin.from('support_messages').insert({
          conversation_id: conversation.id,
          sender_kind: 'user',
          sender_user_id: null,
          body: messageBody,
          source: 'email',
          inbound_message_id: inboundMessageId,
          attachment_path: attachment?.path ?? null,
          attachment_name: attachment?.filename ?? null,
        })
        if (messageError?.code === '23505') {
          if (attachment) await admin.storage.from('support-attachments').remove([attachment.path])
          const { error: deleteError } = await admin.from('support_conversations').delete().eq('id', conversation.id)
          if (deleteError) throw deleteError
          return json({ ok: true, duplicate: true })
        }
        if (messageError) throw messageError
      } catch (error) {
        if (attachment) await admin.storage.from('support-attachments').remove([attachment.path])
        await admin.from('support_conversations').delete().eq('id', conversation.id)
        throw error
      }

      await markLeadReply(admin, sender, event.created_at ?? new Date().toISOString())
      await sendNewConversationNotification({
        apiKey,
        sender,
        subject,
        body: inboundMessageBody(body, received, attachment),
        conversationId: conversation.id,
      })
      return json({ ok: true, conversation_id: conversation.id })
    }

    return json({ ok: true, ignored: event.type })
  } catch (error) {
    if (receiptAdmin && receiptStored) {
      await receiptAdmin.from('resend_webhook_events').delete().eq('id', eventId)
    }
    await captureEdgeError('resend-webhook', error, { event_type: event.type }, 'critical')
    console.error(error)
    return json({ error: 'Webhook processing failed' }, 500)
  }
})
