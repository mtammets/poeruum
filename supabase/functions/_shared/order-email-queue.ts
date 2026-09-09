import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { buildPaidOrderEmail, OrderEmailInputError, type OrderEmailKind, type OrderEmailPayload } from './order-email.ts'
import type { StripeMode } from './stripe-mode.ts'

export type OrderEmailJob = {
  id: string
  order_id: string
  kind: OrderEmailKind
  status: 'pending' | 'processing' | 'retry' | 'accepted' | 'skipped' | 'needs_review'
  lease_token: string
  payload: OrderEmailPayload | null
  first_attempt_at: string | null
  resend_email_id: string | null
  last_error?: string | null
}
type Services = {
  admin: SupabaseClient
  onError?: (error: unknown, job: OrderEmailJob) => Promise<void>
}

export const processOrderEmail = async (services: Services, mode: StripeMode, orderId?: string, kind?: OrderEmailKind) => {
  const { admin } = services
  const { data, error: claimError } = await admin.rpc('claim_order_email_job', {
    mode_value: mode, target_order_id: orderId ?? null, kind_value: kind ?? null,
  })
  if (claimError) throw claimError
  let job = data?.[0] as OrderEmailJob | undefined
  if (!job) return null
  const claimed = job
  const rpc = async (name: string, values: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, { target_job_id: claimed.id, token_value: claimed.lease_token, ...values })
    if (error) throw error
    if (!data) throw new Error('EMAIL_LEASE_LOST')
    return data as OrderEmailJob
  }
  const finish = (status: OrderEmailJob['status'], emailId?: string | null, error?: unknown) => rpc('finish_order_email_job', {
    outcome_value: status, email_id_value: emailId ?? null,
    error_value: error ? (error instanceof Error ? error.message : 'Kirja saatmine ebaõnnestus.') : null,
  })
  try {
    const apiKey = Deno.env.get('RESEND_API_KEY')?.trim()
    if (!apiKey) throw new Error('Puudub RESEND_API_KEY.')
    job = await rpc('prepare_order_email_send', { payload_value: null })
    if (job.status === 'accepted') return await finish('accepted', job.resend_email_id)
    if (job.status === 'skipped') return await finish('skipped')
    if (job.status === 'needs_review') throw new OrderEmailInputError(job.last_error || 'Varasema saatmiskatse tulemus vajab kontrolli.')
    if (!job.payload) {
      const payload = await buildPaidOrderEmail(admin, job.order_id, job.kind, job.id)
      if (!payload) return await finish('skipped')
      job = await rpc('prepare_order_email_send', { payload_value: payload })
    }
    // Recheck the lease and current eligibility immediately before the POST.
    job = await rpc('prepare_order_email_send', { payload_value: null })
    if (job.status === 'accepted' || job.resend_email_id) return await finish('accepted', job.resend_email_id)
    if (job.status === 'skipped') return await finish('skipped')
    if (job.status === 'needs_review') throw new OrderEmailInputError(job.last_error || 'Varasema saatmiskatse tulemus vajab kontrolli.')
    const startedAt = Date.parse(job.first_attempt_at ?? '')
    // Resend retains keys for 24h. Leave margin; a late signed webhook can
    // still reconcile an uncertain job after automatic sends have stopped.
    if (!Number.isFinite(startedAt) || Date.now() - startedAt >= 20 * 60 * 60 * 1000) {
      throw new OrderEmailInputError('Varasema saatmiskatse tulemus vajab enne kordussaatmist kontrolli.')
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `order-${job.order_id}-${job.kind === 'customer' ? 'customer-confirmation' : 'seller-notification'}` },
      body: JSON.stringify(job.payload),
    })
    const result = await response.json().catch(() => null) as { id?: unknown; name?: string } | null
    if (!response.ok) {
      const message = `Resend vastas ${response.status}.`
      if (response.status < 500 && response.status !== 429
        && !(response.status === 409 && result?.name === 'concurrent_idempotent_requests')) throw new OrderEmailInputError(message)
      throw new Error(message)
    }
    if (typeof result?.id !== 'string' || !result.id.trim()) throw new Error('Resend ei tagastanud kirjatunnust.')
    return await finish('accepted', result.id)
  } catch (error) {
    const result = await finish(error instanceof OrderEmailInputError ? 'needs_review' : 'retry', null, error)
    if (services.onError && result.status !== 'accepted') await services.onError(error, claimed)
    return result
  }
}

export const processPaidOrderEmails = async (services: Services, mode: StripeMode, orderId: string) => {
  if (Deno.env.get('ORDER_EMAIL_WORKER_ENABLED') === 'false') return []
  const results = await Promise.allSettled([
    processOrderEmail(services, mode, orderId, 'customer'),
    processOrderEmail(services, mode, orderId, 'seller'),
  ])
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Kirjade saatmisoleku salvestamine ebaõnnestus.')
  return results.map((result) => (result as PromiseFulfilledResult<OrderEmailJob | null>).value)
}

// Call only after verifying the Resend webhook signature. SQL commits the
// receipt and delivery state together, so a process crash cannot lose delivery.
export const recordOrderEmailEvent = async (admin: SupabaseClient, eventId: string, event: {
  type: string; created_at?: string; data: Record<string, unknown>
}) => {
  const rawTags = event.data.tags
  const tags = Array.isArray(rawTags)
    ? Object.fromEntries(rawTags.map((tag) => [String(tag?.name ?? ''), String(tag?.value ?? '')]))
    : rawTags && typeof rawTags === 'object' ? rawTags as Record<string, unknown> : {}
  const kind = tags.email_type === 'order_customer_confirmation' ? 'customer'
    : tags.email_type === 'order_seller_notification' ? 'seller' : null
  const status = event.type.startsWith('email.') ? event.type.slice(6) : ''
  if (!kind || !['sent','delivery_delayed','delivered','failed','bounced','complained','suppressed'].includes(status)) return false
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(String(tags.order_email_job_id)) || !uuid.test(String(tags.order_id))) return false
  const recipients = Array.isArray(event.data.to) ? event.data.to : []
  if (recipients.length !== 1 || typeof event.data.email_id !== 'string' || !event.created_at || !Number.isFinite(Date.parse(event.created_at))) {
    throw new Error('Tellimuse kirja kohaletoimetamise sündmus on puudulik.')
  }
  const { data, error } = await admin.rpc('record_order_email_delivery', {
    target_job_id: tags.order_email_job_id, order_id_value: tags.order_id, kind_value: kind,
    event_id_value: eventId, email_id_value: event.data.email_id, recipient_value: String(recipients[0]),
    status_value: status, occurred_at_value: event.created_at,
  })
  if (error) throw error
  return data === true
}
