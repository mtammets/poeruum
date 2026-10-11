import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { withdrawalTime } from '../../../shared/withdrawal.ts'
import { safeSenderName } from './order-email-template.ts'
import type { OrderEmailPayload } from './order-email.ts'
import { captureEdgeError } from './security.ts'
import type { StripeMode } from './stripe-mode.ts'

type Declaration = {
  id: string; store_name: string; seller_email: string; customer_email: string; customer_name: string
  statement: string; submitted_at: string; order_reference: string
}
type EmailJob = {
  id: string; withdrawal_id: string; kind: 'customer' | 'seller'; lease_token: string
  payload: OrderEmailPayload | null; first_attempt_at: string | null; resend_email_id: string | null; status: string
}
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
export function withdrawalEmail(declaration: Declaration, kind: EmailJob['kind'], jobId: string): OrderEmailPayload {
  const title = kind === 'customer' ? 'Taganemisavaldus on kätte saadud' : 'Uus taganemisavaldus'
  const sender = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'Poeruum <teavitused@send.poeruum.ee>'
  const address = sender.match(/<([^<>]+)>/)?.[1]?.trim() || sender
  const text = `${title}\n\nPood: ${declaration.store_name}\nAvalduse number: ${declaration.id}\nEsitatud: ${withdrawalTime(declaration.submitted_at)} (Eesti aeg)\nNimi: ${declaration.customer_name}\nKinnituse e-post: ${declaration.customer_email}\n\n${declaration.statement}\n\nSee kinnitus tõendab avalduse kättesaamist. Kauba tagastamine ja tagasimakse korraldatakse müüjaga eraldi.\nMüüja kontakt: ${declaration.seller_email}`
  return {
    from: `${safeSenderName(declaration.store_name)} via Poeruum <${address}>`,
    to: [kind === 'customer' ? declaration.customer_email : declaration.seller_email],
    reply_to: kind === 'customer' ? declaration.seller_email : declaration.customer_email,
    subject: `${title} · ${declaration.order_reference.replace(/[\r\n]/g, ' ')}`,
    text, html: `<html lang="et"><body style="font:16px/1.7 Arial,sans-serif;color:#242721"><div style="max-width:600px;margin:auto;padding:32px"><h1 style="font-size:24px">${escape(title)}</h1><p style="white-space:pre-wrap">${escape(text.slice(title.length).trim())}</p></div></body></html>`,
    tags: [{ name: 'email_type', value: `withdrawal_${kind}` }, { name: 'withdrawal_email_job_id', value: jobId }],
  }
}
class PermanentEmailError extends Error {}
export async function processWithdrawalEmail(admin: SupabaseClient, mode: StripeMode, withdrawalId?: string) {
  const { data, error } = await admin.rpc('claim_withdrawal_email', { mode_value: mode, target_withdrawal_id: withdrawalId ?? null })
  if (error) throw error
  let job = data?.[0] as EmailJob | undefined
  if (!job) return null
  const claimed = job
  const rpc = async (name: string, values: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, { target_job_id: claimed.id, token_value: claimed.lease_token, ...values })
    if (error) throw error
    return data as EmailJob
  }
  const finish = (outcome: string, emailId: string | null = null, reason: string | null = null) => rpc('finish_withdrawal_email', { outcome_value: outcome, email_id_value: emailId, error_value: reason })
  try {
    const key = Deno.env.get('RESEND_API_KEY')?.trim()
    if (!key) throw new Error('Puudub RESEND_API_KEY.')
    if (!job.payload) {
      const { data, error } = await admin.from('store_withdrawals').select('*').eq('id', job.withdrawal_id).single()
      if (error) throw error
      job = await rpc('prepare_withdrawal_email', { payload_value: withdrawalEmail(data, job.kind, job.id) })
    }
    job = await rpc('prepare_withdrawal_email', { payload_value: null })
    if (job.resend_email_id) return await finish('accepted', job.resend_email_id)
    const firstAttempt = Date.parse(job.first_attempt_at ?? '')
    if (!Number.isFinite(firstAttempt) || Date.now() - firstAttempt >= 20 * 60 * 60 * 1000) throw new PermanentEmailError('Saatmiskatse tulemus vajab kontrolli.')
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `withdrawal-${job.id}` },
      body: JSON.stringify(job.payload),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      const message = `Resend vastas ${response.status}.`
      if (response.status < 500 && response.status !== 429 && !(response.status === 409 && result?.name === 'concurrent_idempotent_requests')) throw new PermanentEmailError(message)
      throw new Error(message)
    }
    if (typeof result?.id !== 'string' || !result.id) throw new Error('Resend ei tagastanud kirjatunnust.')
    return await finish('accepted', result.id)
  } catch (error) {
    const result = await finish(error instanceof PermanentEmailError ? 'needs_review' : 'retry', null, error instanceof Error ? error.message : 'Kirja saatmine ebaõnnestus.')
    if (result.status !== 'accepted') await captureEdgeError('withdrawal-email', error, { job_id: claimed.id }, 'critical')
    return result
  }
}

export async function recordWithdrawalEmailEvent(admin: SupabaseClient, event: { type: string; created_at?: string; data: Record<string, unknown> }) {
  const raw = event.data.tags
  const tags = Array.isArray(raw) ? Object.fromEntries(raw.map((tag) => [String(tag?.name ?? ''), String(tag?.value ?? '')])) : raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  if (!['withdrawal_customer', 'withdrawal_seller'].includes(String(tags.email_type))) return
  const status = event.type.replace(/^email\./, '')
  if (!['sent','delivery_delayed','delivered','failed','bounced','complained','suppressed'].includes(status)) return
  if (!/^[0-9a-f-]{36}$/i.test(String(tags.withdrawal_email_job_id)) || !Array.isArray(event.data.to) || event.data.to.length !== 1
    || typeof event.data.email_id !== 'string' || !event.created_at || !Number.isFinite(Date.parse(event.created_at))) throw new Error('Taganemiskirja sündmus on puudulik.')
  const { error } = await admin.rpc('record_withdrawal_email_delivery', {
    target_job_id: tags.withdrawal_email_job_id, email_id_value: event.data.email_id, recipient_value: event.data.to[0], status_value: status, occurred_at_value: event.created_at,
  })
  if (error) throw error
  if (['failed','bounced','complained','suppressed'].includes(status)) await captureEdgeError('withdrawal-email', new Error(`Kinnituse kohaletoimetamine: ${status}`), { job_id: tags.withdrawal_email_job_id }, 'critical')
}
