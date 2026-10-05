import { createClient } from 'npm:@supabase/supabase-js@2'
import { processAdminPush, vapidConfig } from '../_shared/admin-push.ts'
import { captureEdgeError } from '../_shared/security.ts'

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const secret = Deno.env.get('ONBOARDING_CRON_SECRET')?.trim()
  if (!secret || request.headers.get('Authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 })
  if (!vapidConfig()) return Response.json({ error: 'Push is not configured' }, { status: 503 })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('POERUUM_SUPABASE_SECRET_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
    const started = Date.now()
    const outcomes: Record<string, number> = {}
    for (let i = 0; i < 30 && Date.now() - started < 40_000; i++) {
      const outcome = await processAdminPush(admin)
      if (!outcome) break
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
    }
    return Response.json({ outcomes })
  } catch {
    await captureEdgeError('admin-push-dispatch', new Error('Push queue processing failed'))
    return Response.json({ error: 'Push queue processing failed' }, { status: 500 })
  }
})
