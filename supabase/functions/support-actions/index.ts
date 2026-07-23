import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;')

const textValue = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)
const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return 'Klienditoe toiming ebaõnnestus.'
}
const categoryValues = new Set(['question', 'setup', 'payments', 'orders', 'technical', 'feedback'])
const statusValues = new Set(['open', 'waiting_user', 'resolved'])

const sendEmail = async (payload: Record<string, unknown>) => {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      'User-Agent': 'poeruum-support/1.0',
    },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string }
  if (!response.ok || !result.id) throw new Error(result.message || `Resend vastas ${response.status}.`)
  return result.id
}

const emailFrame = (title: string, body: string, action?: { label: string; url: string }) => `<!doctype html>
<html lang="et"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1efe9;color:#23221f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:36px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 4px 18px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:11px"><img src="https://poeruum.ee/images/poeruum-email-logo.png?v=2" width="40" height="40" alt=""></td><td style="font-size:18px;font-weight:800;color:#17231c">Poeruum</td></tr></table></td></tr>
<tr><td style="overflow:hidden;border-radius:22px;background:#fff"><div style="height:8px;background:#d9ff43"></div><div style="padding:36px">
<div style="margin-bottom:12px;color:#77736a;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">Klienditugi</div>
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2">${escapeHtml(title)}</h1>
<div style="color:#56534d;font-size:16px;line-height:1.65">${body}</div>
${action ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px"><tr><td style="border-radius:999px;background:#171714"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:14px 23px;color:#fff;text-decoration:none;font-size:15px;font-weight:700">${escapeHtml(action.label)} &nbsp;→</a></td></tr></table>` : ''}
</div></td></tr><tr><td style="padding:20px 4px 0;color:#8a857d;font-size:12px">Poeruum · sinu e-pood 10 minutiga</td></tr>
</table></td></tr></table></body></html>`

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization') ?? ''
    const token = authorization.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Palun logi sisse.' }, 401)

    const supabaseUrl = requiredEnv('SUPABASE_URL')
    const userClient = createClient(supabaseUrl, requiredEnv('POERUUM_SUPABASE_PUBLISHABLE_KEY'), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser(token)
    if (userError || !user) return json({ error: 'Sinu seanss on aegunud. Palun logi uuesti sisse.' }, 401)

    const admin = createClient(supabaseUrl, requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const isAdmin = user.app_metadata?.role === 'admin'
    const input = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = textValue(input.action, 40)
    const appUrl = (Deno.env.get('APP_URL')?.trim() || 'https://poeruum.ee').replace(/\/$/, '')
    const from = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'Poeruum <teavitused@send.poeruum.ee>'
    const fallbackReplyTo = Deno.env.get('SUPPORT_REPLY_TO')?.trim()
    const inboundDomain = Deno.env.get('SUPPORT_INBOUND_DOMAIN')?.trim().replace(/^@/, '')
    const conversationReplyTo = (conversationId: string) => inboundDomain
      ? `Poeruumi klienditugi <vastus+${conversationId}@${inboundDomain}>`
      : fallbackReplyTo

    if (action === 'create') {
      if (isAdmin) return json({ error: 'Administraatori kontolt ei saa kasutaja päringut luua.' }, 403)
      const subject = textValue(input.subject, 160)
      const body = textValue(input.body, 10000)
      const category = textValue(input.category, 30) || 'question'
      if (subject.length < 2 || body.length < 2 || !categoryValues.has(category)) return json({ error: 'Lisa teema ja küsimus.' }, 400)

      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { count } = await admin.from('support_conversations').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since)
      if ((count ?? 0) >= 5) return json({ error: 'Oled saatnud lühikese aja jooksul mitu küsimust. Proovi veidi hiljem uuesti.' }, 429)

      const { data: store } = await admin.from('stores').select('id,name').eq('owner_id', user.id).order('created_at').limit(1).maybeSingle()
      const { data: conversation, error: conversationError } = await admin.from('support_conversations').insert({
        user_id: user.id,
        store_id: store?.id ?? null,
        subject,
        category,
        page_url: textValue(input.page_url, 1000),
        user_agent: textValue(input.user_agent, 1000),
      }).select('id').single()
      if (conversationError || !conversation) throw conversationError || new Error('Vestlust ei loodud.')

      const attachmentPath = textValue(input.attachment_path, 1000)
      const safeAttachmentPath = attachmentPath.startsWith(`${user.id}/`) ? attachmentPath : null
      const { error: messageError } = await admin.from('support_messages').insert({
        conversation_id: conversation.id,
        sender_kind: 'user',
        sender_user_id: user.id,
        body,
        attachment_path: safeAttachmentPath,
        attachment_name: safeAttachmentPath ? textValue(input.attachment_name, 255) : null,
      })
      if (messageError) throw messageError

      const emailTasks: Promise<unknown>[] = []
      const replyTo = conversationReplyTo(conversation.id)
      if (user.email) emailTasks.push(sendEmail({
        from, to: [user.email], ...(replyTo ? { reply_to: replyTo } : {}),
        subject: `Saime su küsimuse kätte: ${subject}`,
        html: emailFrame('Saime su küsimuse kätte', `<p style="margin:0">Aitäh, et kirjutasid. Vaatame su küsimuse üle ja vastame esimesel võimalusel.</p><div style="margin-top:20px;padding:18px;border-radius:14px;background:#f6f4ef"><strong>${escapeHtml(subject)}</strong><p style="margin:8px 0 0">${escapeHtml(body).replaceAll('\n', '<br>')}</p></div>`, { label: 'Ava Poeruum', url: appUrl }),
        text: `Saime su küsimuse kätte\n\n${subject}\n${body}\n\nVaatame selle üle ja vastame esimesel võimalusel.`,
        tags: [{ name: 'email_type', value: 'support_confirmation' }, { name: 'conversation_id', value: conversation.id }],
      }))
      const notificationEmail = Deno.env.get('SUPPORT_NOTIFICATION_EMAIL')?.trim()
      if (notificationEmail) emailTasks.push(sendEmail({
        from, to: [notificationEmail], subject: `Uus klienditoe küsimus: ${subject}`,
        html: emailFrame('Uus klienditoe küsimus', `<p style="margin:0 0 12px"><strong>${escapeHtml(store?.name || user.email || 'Kasutaja')}</strong> · ${escapeHtml(user.email)}</p><p style="margin:0">${escapeHtml(body).replaceAll('\n', '<br>')}</p>`, { label: 'Ava klienditugi', url: `${appUrl}/admin` }),
        text: `${user.email}\n${subject}\n\n${body}\n\n${appUrl}/admin`,
        tags: [{ name: 'email_type', value: 'support_notification' }, { name: 'conversation_id', value: conversation.id }],
      }))
      await Promise.allSettled(emailTasks)
      return json({ id: conversation.id })
    }

    const conversationId = textValue(input.conversation_id, 60)
    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return json({ error: 'Vestlust ei leitud.' }, 400)
    const { data: conversation, error: conversationError } = await admin.from('support_conversations').select('*').eq('id', conversationId).single()
    if (conversationError || !conversation) return json({ error: 'Vestlust ei leitud.' }, 404)

    if (action === 'user_reply') {
      if (isAdmin || conversation.user_id !== user.id) return json({ error: 'Ligipääs puudub.' }, 403)
      const body = textValue(input.body, 10000)
      if (!body) return json({ error: 'Kirjuta vastus.' }, 400)
      const { error } = await admin.from('support_messages').insert({ conversation_id: conversationId, sender_kind: 'user', sender_user_id: user.id, body })
      if (error) throw error
      return json({ ok: true })
    }

    if (!isAdmin) return json({ error: 'Administraatori ligipääs puudub.' }, 403)

    if (action === 'status') {
      const status = textValue(input.status, 30)
      if (!statusValues.has(status)) return json({ error: 'Tundmatu olek.' }, 400)
      const { error } = await admin.from('support_conversations').update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null }).eq('id', conversationId)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'admin_reply') {
      const body = textValue(input.body, 10000)
      const isInternal = input.is_internal === true
      if (!body) return json({ error: 'Kirjuta vastus.' }, 400)
      let resendEmailId: string | null = null
      let deliveryStatus: string | null = null
      if (!isInternal) {
        const { data: recipient, error: recipientError } = await admin.auth.admin.getUserById(conversation.user_id)
        if (recipientError || !recipient.user.email) return json({ error: 'Kasutaja e-posti aadressi ei leitud.' }, 400)
        const replyTo = conversationReplyTo(conversation.id)
        resendEmailId = await sendEmail({
          from, to: [recipient.user.email], ...(replyTo ? { reply_to: replyTo } : {}),
          subject: `Re: ${conversation.subject}`,
          html: emailFrame('Vastus Poeruumi klienditoelt', `<p style="margin:0">${escapeHtml(body).replaceAll('\n', '<br>')}</p><p style="margin:24px 0 0;color:#8a857d;font-size:13px">Sinu küsimus: ${escapeHtml(conversation.subject)}</p>`, { label: 'Ava Poeruum', url: appUrl }),
          text: `${body}\n\nSinu küsimus: ${conversation.subject}\n${appUrl}`,
          tags: [{ name: 'email_type', value: 'support_reply' }, { name: 'conversation_id', value: conversation.id }],
        })
        deliveryStatus = 'sent'
      }
      const { data: message, error } = await admin.from('support_messages').insert({
        conversation_id: conversationId, sender_kind: 'admin', sender_user_id: user.id, body,
        is_internal: isInternal, resend_email_id: resendEmailId, delivery_status: deliveryStatus,
        delivery_updated_at: deliveryStatus ? new Date().toISOString() : null,
      }).select('id').single()
      if (error) throw error
      return json({ id: message.id })
    }

    return json({ error: 'Tundmatu tegevus.' }, 400)
  } catch (error) {
    console.error(error)
    return json({ error: errorMessage(error) }, 500)
  }
})
