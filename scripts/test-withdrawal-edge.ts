import { withdrawalStatement } from '../shared/withdrawal.ts'
import { processWithdrawalEmail, withdrawalEmail, recordWithdrawalEmailEvent } from '../supabase/functions/_shared/withdrawal-email.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message) }
Deno.test('withdrawal API records intent without revealing orders or triggering money movement, and sends durable confirmations', async test => {
  const values = { SUPABASE_URL: 'https://withdrawal.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'fixture-secret', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_MODE: 'test', RATE_LIMIT_SALT: 'fixture', RESEND_API_KEY: 'fixture', RESEND_FROM_EMAIL: 'Poeruum <teavitused@send.poeruum.ee>', ORDER_EMAIL_WORKER_ENABLED: 'false' }
  const previous = Object.entries(values).map(([key, value]) => { const old = Deno.env.get(key); Deno.env.set(key, value); return [key, old] as const })
  const originalFetch = globalThis.fetch, originalServe = Deno.serve
  let handler: (request: Request) => Promise<Response>
  // @ts-expect-error capture the handler without opening a listener
  Deno.serve = (callback: typeof handler) => { handler = callback }
  const store = { id: '82000000-0000-4000-8000-000000000002', owner_id: 'owner', name: 'Pood', is_published: true, stripe_account_mode: 'test', settings: { contactEmail: 'seller@example.invalid', customerConfirmations: false, sellerNotifications: false } }
  const input = { storeId: store.id, requestId: '82000000-0000-4000-8000-000000000004', customerName: 'Ostja', customerEmail: 'buyer@example.invalid', orderReference: 'PR-OLD', scope: '' }
  let allowed = true, found = true, receiptFound = true, matchingOrder = false, mailStatus = 200, saveError = false, queueError = false
  const declarations = new Map<string, Record<string, unknown>>()
  const jobs: Array<Record<string, unknown>> = []
  const sends: Array<{ key: string; body: Record<string, unknown> }> = []
  const response = (value: unknown, status = 200) => Response.json(value, { status })
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    assert(url.hostname !== 'api.stripe.com', 'Withdrawal must never call Stripe')
    if (url.pathname.endsWith('/consume_rate_limit')) return response([{ allowed, retry_after_seconds: 60 }])
    if (url.pathname.endsWith('/record_application_error')) return response(null)
    if (url.pathname.endsWith('/stores')) { assert(request.method === 'GET', 'Store mutation'); return response(found ? store : null) }
    if (url.pathname.endsWith('/order_receipt_access')) return response(receiptFound ? { order_id: 'order' } : null)
    if (url.pathname.endsWith('/orders')) {
      assert(request.method === 'GET', 'Withdrawal changed an order')
      return response(url.searchParams.has('customer_email') ? matchingOrder ? [{ id: 'order' }] : []
        : url.searchParams.has('id') ? { id: 'order', store_id: store.id, stripe_mode: 'test' } : [{ id: 'order' }])
    }
    if (url.pathname.endsWith('/submit_store_withdrawal')) {
      if (saveError) return response({ message: 'Database unavailable' }, 503)
      const body = await request.json()
      if (!declarations.has(body.request_id)) {
        declarations.set(body.request_id, { id: body.request_id, submitted_at: '2026-10-11T12:00:00Z', statement: withdrawalStatement({ orderReference: body.reference_value, scope: body.scope_value }),
          customer_name: body.name_value, customer_email: body.email_value, store_name: body.store_name_value, seller_email: body.seller_email_value, order_reference: body.reference_value, order_id: body.target_order_id })
        for (const kind of ['customer', 'seller']) jobs.push({ id: `${body.request_id}-${kind}`, withdrawal_id: body.request_id, kind, status: 'pending', lease_token: 'lease', payload: null, first_attempt_at: null, resend_email_id: null })
      }
      return response(declarations.get(body.request_id))
    }
    if (url.pathname.endsWith('/claim_withdrawal_email')) {
      if (queueError) return response({ message: 'Queue temporarily unavailable' }, 503)
      const body = await request.json()
      const job = jobs.find(job => ['pending', 'retry'].includes(String(job.status)) && (!body.target_withdrawal_id || job.withdrawal_id === body.target_withdrawal_id))
      if (job) job.status = 'processing'
      return response(job ? [job] : [])
    }
    if (url.pathname.endsWith('/store_withdrawals')) return response(declarations.get(url.searchParams.get('id')?.slice(3) ?? ''))
    if (url.pathname.endsWith('/prepare_withdrawal_email')) {
      const body = await request.json(); const job = jobs.find(job => job.id === body.target_job_id)!
      if (!job.payload && body.payload_value) { job.payload = body.payload_value; job.first_attempt_at = new Date().toISOString() }
      return response(job)
    }
    if (url.pathname.endsWith('/finish_withdrawal_email')) {
      const body = await request.json(); const job = jobs.find(job => job.id === body.target_job_id)!
      job.status = body.outcome_value; job.resend_email_id = body.email_id_value
      return response(job)
    }
    if (url.pathname.endsWith('/record_withdrawal_email_delivery')) return response(true)
    if (url.hostname === 'api.resend.com') {
      sends.push({ key: request.headers.get('Idempotency-Key')!, body: await request.json() })
      return response(mailStatus === 200 ? { id: `email-${sends.length}` } : { message: 'Unavailable' }, mailStatus)
    }
    throw new Error(`Unexpected networking: ${request.method} ${url.pathname}`)
  }
  try {
    await import('../supabase/functions/order-withdrawal/index.ts')
    const call = (body: unknown = input) => handler(new Request('https://edge.example.invalid', { method: 'POST', body: JSON.stringify(body) }))
    const admin = createClient(values.SUPABASE_URL, values.POERUUM_SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
    await test.step('invalid and rate-limited requests cannot persist or send', async () => {
      for (const body of [null, { ...input, customerEmail: 'invalid' }, { ...input, customerName: 'Bad\nHeader' }, { ...input, scope: 'x'.repeat(2001) }]) assert((await call(body)).status === 400, 'Bad input accepted')
      allowed = false; assert((await call()).status === 429, 'Rate limit ignored'); allowed = true
      found = false; assert((await call()).status === 404, 'Missing shop accepted'); found = true
      receiptFound = false; assert((await call({ ...input, access: { token: 'a'.repeat(64) } })).status === 404, 'Bad receipt accepted'); receiptFound = true
      assert(sends.length === 0 && declarations.size === 0, 'Rejected input caused side effects')
    })
    await test.step('unmatched/old references are accepted without exposing customer or order data', async () => {
      const result = await call()
      assert(result.status === 200 && result.headers.get('Cache-Control') === 'no-store', 'Declaration failed or cacheable')
      const body = await result.json()
      assert(Object.keys(body).join() === 'confirmation' && Object.keys(body.confirmation).sort().join() === 'id,statement,submittedAt', 'Response leaks order/customer data')
      assert(declarations.get(input.requestId)?.order_id === null, 'Invented a matched order')
      assert(sends.length === 2, 'Mandatory confirmations disabled by ordinary email settings')
      for (const send of sends) {
        assert(String(send.body.text).includes('15:00') && String(send.body.text).includes('Taganen müügilepingust.'), 'Email missing durable declaration or Estonia time')
        assert(!send.body.attachments, 'Unrequested data in confirmation')
      }
      await call(); assert(sends.length === 2 && jobs.length === 2, 'Duplicate submission resent email')
    })
    await test.step('database failure never sends; queued email failure never loses a submitted declaration', async () => {
      const next = { ...input, requestId: '82000000-0000-4000-8000-000000000005', scope: 'Sinine kruus' }
      saveError = true; assert((await call(next)).status === 503 && sends.length === 2, 'Sent before durable save'); saveError = false
      mailStatus = 503; matchingOrder = true
      assert((await call(next)).status === 200 && declarations.has(next.requestId), 'Mail outage lost declaration')
      const first = sends.find(send => send.key.includes(next.requestId))!
      mailStatus = 200
      await processWithdrawalEmail(admin, 'test', next.requestId)
      const retried = sends.filter(send => send.key === first.key)
      assert(retried.length === 2 && JSON.stringify(retried[0].body) === JSON.stringify(retried[1].body), 'Retry changed payload or idempotency key')
      queueError = true
      assert((await call({ ...input, requestId: '82000000-0000-4000-8000-000000000006' })).status === 200, 'Queue outage invalidated committed submission')
      queueError = false
    })
    await test.step('old ambiguous mail is not resent after provider deduplication expires; HTML is escaped', async () => {
      const pending = jobs.find(job => job.status === 'retry')!; pending.first_attempt_at = '2020-01-01T00:00:00Z'
      const before = sends.length
      await processWithdrawalEmail(admin, 'test', String(pending.withdrawal_id))
      assert(sends.length === before && pending.status === 'needs_review', 'Old ambiguous email resent')
      const payload = withdrawalEmail({ id: 'id', store_name: 'Shop', seller_email: 'seller@example.invalid', customer_email: 'customer@example.invalid', customer_name: '<script>alert(1)</script>', statement: '<img src=x>', submitted_at: '2026-10-11T12:00:00Z', order_reference: 'PR-1' }, 'customer', 'job')
      assert(!payload.html.includes('<script>') && payload.html.includes('&lt;script&gt;'), 'Unescaped buyer input in email')
      await recordWithdrawalEmailEvent(admin, { type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'provider', to: ['buyer@example.invalid'], tags: { email_type: 'withdrawal_customer', withdrawal_email_job_id: input.requestId } } })
    })
  } finally {
    globalThis.fetch = originalFetch; Deno.serve = originalServe
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value) }
  }
})
