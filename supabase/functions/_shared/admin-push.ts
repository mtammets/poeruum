// @deno-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type PushSubscriptionData = { endpoint: string; keys: { p256dh: string; auth: string } }
export type PushNotice = { title: string; body: string; tag: string; url: string }
export type PushOutcome = 'sent' | 'gone' | 'retry'
export type PushJob = { id: string; lease_token: string; subscription_id: string; endpoint: string; p256dh: string; auth: string; kind: 'visit' | 'account' }

// Subscriptions are supplied by browsers, but must never turn the sender into an SSRF proxy.
export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      && (url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com')
        || url.hostname === 'fcm.googleapis.com'
        || url.hostname === 'updates.push.services.mozilla.com' || url.hostname.endsWith('.notify.windows.com'))
  } catch { return false }
}

export function parsePushSubscription(value: unknown): PushSubscriptionData | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<PushSubscriptionData>
  if (!validPushEndpoint(input.endpoint) || !input.keys
    || !/^[A-Za-z0-9_-]{87}$/.test(input.keys.p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(input.keys.auth)) return null
  return { endpoint: input.endpoint, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } }
}

export function pushNotice(kind: 'visit' | 'account' | 'test', id: string): PushNotice {
  return {
    title: kind === 'account' ? 'Uus konto Poeruumis' : kind === 'visit' ? 'Uus avalehe külastus' : 'Poeruumi prooviteavitus',
    body: kind === 'account' ? 'Poeruumiga liitus uus kasutaja.' : kind === 'visit'
      ? 'Keegi avas Poeruumi avalehe.' : 'Märguanded on selles seadmes lubatud. Need jõuavad ka lukustatud ekraanile.',
    tag: `poeruum-${id}`, url: '/admin',
  }
}

export function vapidConfig() {
  const publicKey = Deno.env.get('ADMIN_PUSH_VAPID_PUBLIC_KEY')?.trim()
  const privateKey = Deno.env.get('ADMIN_PUSH_VAPID_PRIVATE_KEY')?.trim()
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject: 'mailto:info@poeruum.ee' }
}

export async function sendAdminPush(subscription: PushSubscriptionData, notice: PushNotice, request = fetch): Promise<PushOutcome> {
  const vapidDetails = vapidConfig()
  if (!vapidDetails) throw new Error('Push is not configured')
  if (!parsePushSubscription(subscription)) return 'gone'
  const details = webpush.generateRequestDetails(subscription, JSON.stringify(notice), {
    vapidDetails, TTL: 3600, urgency: 'normal', contentEncoding: 'aes128gcm',
    topic: notice.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(-32),
  })
  // Native fetch works in Supabase Edge; never follow a push endpoint redirect.
  const response = await request(details.endpoint, {
    method: 'POST', headers: details.headers as Record<string, string>,
    body: new Uint8Array(details.body!), redirect: 'error', signal: AbortSignal.timeout(8000),
  })
  await response.body?.cancel()
  return response.ok ? 'sent' : [404, 410].includes(response.status) ? 'gone' : 'retry'
}

export async function processAdminPush(admin: SupabaseClient, send = sendAdminPush): Promise<PushOutcome | null> {
  const { data, error } = await admin.rpc('claim_admin_push_job')
  if (error) throw new Error('Could not claim push job')
  const job = data?.[0] as PushJob | undefined
  if (!job) return null
  let outcome: PushOutcome = 'retry'
  try { outcome = await send({ endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } }, pushNotice(job.kind, job.id)) } catch { /* Retry without logging private endpoints or keys. */ }
  const { error: finishError } = await admin.rpc('finish_admin_push_job', { target_id: job.id, target_token: job.lease_token, outcome })
  if (finishError) throw new Error('Could not finish push job')
  return outcome
}
