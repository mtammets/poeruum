import { createClient } from 'npm:@supabase/supabase-js@2'
import { processOrderEmail } from '../_shared/order-email-queue.ts'
import { assertStripeMode } from '../_shared/stripe-mode.ts'
import { captureEdgeError } from '../_shared/security.ts'

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    if (request.headers.get('Authorization') !== `Bearer ${requiredEnv('ONBOARDING_CRON_SECRET')}`) return json({ error: 'Unauthorized' }, 401)
    if (Deno.env.get('ORDER_EMAIL_WORKER_ENABLED') === 'false') return json({ enabled: false })
    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const mode = assertStripeMode(requiredEnv('STRIPE_SECRET_KEY'))
    const outcomes: Record<string, number> = {}
    const startedAt = Date.now()
    // One bad recipient cannot prevent later jobs from being attempted.
    for (let index = 0; index < 20 && Date.now() - startedAt < 40_000; index += 1) {
      const job = await processOrderEmail({ admin, onError: (error, job) => captureEdgeError('order-emails', error,
        { order_id: job.order_id, job_id: job.id, recipient_kind: job.kind }, 'critical') }, mode)
      if (!job) break
      outcomes[job.status] = (outcomes[job.status] ?? 0) + 1
    }
    return json({ outcomes })
  } catch (error) {
    await captureEdgeError('order-emails', error, {}, 'critical')
    return json({ error: 'Tellimuskirjade taustatöö ebaõnnestus.' }, 500)
  }
})
