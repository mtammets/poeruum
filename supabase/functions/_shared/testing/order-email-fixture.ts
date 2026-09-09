import { vi } from 'vitest'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { processPaidOrderEmails, type OrderEmailJob } from '../order-email-queue.ts'

// Provider acceptance and DB state are deliberately separate: a lost response
// or failed DB write must not cause another accepted message on retry.
export const emailFixture = (paid = true) => {
  const order: Record<string, any> = {
    id: '77000000-0000-4000-8000-000000000003', store_id: '77000000-0000-4000-8000-000000000002',
    order_number: 'PR-EMAIL-TEST', total: 27.32, product_subtotal: 27.32, items: [{ name: '<Test product>', price: 27.32, quantity: 1 }],
    payment_status: paid ? 'paid' : 'pending', stripe_mode: 'test', stripe_checkout_session_id: 'cs_test_1',
    stripe_payment_intent_id: paid ? 'pi_1' : null,
    customer_name: 'Test Customer', customer_email: 'customer@example.invalid', delivery: 'Tulen ise järele',
    seller_vat_registered: false, seller_vat_amount: 0, customer_confirmation_sent_at: null, seller_notification_sent_at: null,
  }
  const store = { id: order.store_id, owner_id: 'owner-1', name: 'Test store', settings: {
    contactEmail: 'seller@example.invalid', orderNotificationEmail: '', customerConfirmations: true, sellerNotifications: true,
  } }
  const state = { stock: 2, completionFailure: false, customerFailure: false, sellerFailure: false,
    ownerFailure: false, lostResponse: false, acceptanceFailure: false, leaseLost: false }
  const jobs: (OrderEmailJob & { due: number; leased: boolean })[] = []
  const enqueue = () => {
    for (const [index, kind] of (['customer','seller'] as const).entries()) {
      if (!jobs.some((job) => job.kind === kind)) jobs.push({
        id: `77000000-0000-4000-8000-00000000000${index + 4}`, order_id: order.id, kind,
        status: 'pending', lease_token: `token-${kind}`, payload: null, first_attempt_at: null,
        resend_email_id: null, due: 0, leased: false,
      })
    }
  }
  if (paid) enqueue()
  const rpc = vi.fn(async (name: string, args: any) => {
    if (name === 'complete_stripe_order') {
      if (state.completionFailure) return { error: new Error('Database unavailable') }
      if (!['paid','refunded'].includes(order.payment_status)) {
        order.payment_status = 'paid'; order.stripe_payment_intent_id = args.payment_intent_id; state.stock -= 1; enqueue()
      }
      return { error: null }
    }
    if (name === 'claim_order_email_job') {
      const job = jobs.find((job) => ['pending','retry','processing'].includes(job.status) && !job.leased && job.due <= Date.now()
        && (!args.kind_value || job.kind === args.kind_value))
      if (!job) return { data: [], error: null }
      job.leased = true; job.status = 'processing'
      return { data: [structuredClone(job)], error: null }
    }
    const job = jobs.find((job) => job.id === args.target_job_id)!
    if (state.leaseLost) return { error: new Error('EMAIL_LEASE_LOST') }
    if (name === 'prepare_order_email_send') {
      const legacySent = order[job.kind === 'customer' ? 'customer_confirmation_sent_at' : 'seller_notification_sent_at']
      if (legacySent) job.status = 'accepted'
      else if (!job.resend_email_id && (order.payment_status !== 'paid'
        || (job.kind === 'customer' ? store.settings.customerConfirmations : store.settings.sellerNotifications) === false)) {
        job.status = job.payload ? 'needs_review' : 'skipped'
      } else if (!job.payload && args.payload_value) {
        job.payload = structuredClone(args.payload_value); job.first_attempt_at = new Date().toISOString()
      }
    } else if (name === 'finish_order_email_job') {
      if (state.acceptanceFailure && args.outcome_value === 'accepted') return { error: new Error('Acceptance write failed') }
      job.status = job.resend_email_id ? 'accepted' : args.outcome_value
      if (job.status === 'accepted') {
        job.resend_email_id ??= args.email_id_value
        order[job.kind === 'customer' ? 'customer_confirmation_sent_at' : 'seller_notification_sent_at'] = new Date().toISOString()
      }
      job.leased = false; job.due = Date.now() + 30_000
    } else throw new Error(`Unexpected RPC ${name}`)
    return { data: structuredClone(job), error: null }
  })
  const from = (table: string) => {
    const row = table === 'orders' ? order : store
    const filters: [string, unknown][] = []
    const execute = async () => ({ data: filters.every(([key, value]) => (row as any)[key] === value) ? structuredClone(row) : null, error: null })
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key,value]); return query },
      single: execute, maybeSingle: execute }
    return query
  }
  const admin = { from, rpc, auth: { admin: { getUserById: vi.fn(async () => ({
    data: { user: { email: 'owner@example.invalid' } }, error: state.ownerFailure ? new Error('Owner API unavailable') : null,
  })) } } } as unknown as SupabaseClient
  const requests: { body: any; key: string; paymentStatus: string }[] = []
  const accepted = new Map<string, { id: string; body: string }>()
  const fetchEmail = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (url !== 'https://api.resend.com/emails') throw new Error(`Unexpected network request: ${url}`)
    const body = JSON.parse(String(init?.body))
    const key = new Headers(init?.headers).get('Idempotency-Key')!
    requests.push({ body, key, paymentStatus: order.payment_status })
    const kind = body.tags.find((tag: any) => tag.name === 'email_type').value === 'order_customer_confirmation' ? 'customer' : 'seller'
    expectPrepared(kind, body)
    if (kind === 'customer' ? state.customerFailure : state.sellerFailure) return Response.json({ name: 'application_error' }, { status: 503 })
    const previous = accepted.get(key)
    if (previous && previous.body !== String(init?.body)) return Response.json({ name: 'invalid_idempotent_request' }, { status: 409 })
    const entry = previous ?? { id: `email-${kind}`, body: String(init?.body) }
    accepted.set(key, entry)
    if (state.lostResponse) throw new Error('Connection interrupted after acceptance')
    return Response.json({ id: entry.id })
  })
  const expectPrepared = (kind: string, body: unknown) => {
    if (JSON.stringify(jobs.find((job) => job.kind === kind)?.payload) !== JSON.stringify(body)) throw new Error('Email POST preceded durable preparation')
  }
  vi.stubGlobal('fetch', fetchEmail)
  const onError = vi.fn(async () => {})
  const services = { admin, onError }
  const run = () => processPaidOrderEmails(services, 'test', order.id)
  const makeDue = () => { jobs.forEach((job) => { job.due = 0 }) }
  return { admin, order, store, state, jobs, rpc, requests, accepted, fetchEmail, services, run, makeDue, onError }
}
