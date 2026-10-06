import { createClient } from 'npm:@supabase/supabase-js@2'
import { parsePushSubscription, pushNotice, sendAdminPush, validPushEndpoint, vapidConfig } from '../_shared/admin-push.ts'
import { checkRateLimit, rateLimitResponse } from '../_shared/security.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '')
    if (!token) return json({ error: 'Logi administraatorina sisse.' }, 401)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('POERUUM_SUPABASE_SECRET_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)
    if (user.app_metadata?.role !== 'admin') return json({ error: 'Administraatori ligipääs on nõutud.' }, 403)
    const limit = await checkRateLimit(request, 'admin-push', 30, 60, user.id)
    if (!limit.allowed) return rateLimitResponse(limit.retry_after_seconds, cors)
    const raw = await request.text()
    if (raw.length > 5000) return json({ error: 'Päring on liiga pikk.' }, 413)
    let input
    try { input = JSON.parse(raw) } catch { return json({ error: 'Vigane päring.' }, 400) }
    if (!input || typeof input !== 'object') return json({ error: 'Vigane päring.' }, 400)
    const config = vapidConfig()
    if (input.action === 'config') return json({ available: Boolean(config), publicKey: config?.publicKey ?? null })
    if (!['status', 'subscribe', 'unsubscribe', 'test', 'preferences'].includes(input.action)) return json({ error: 'Tundmatu toiming.' }, 400)
    const preferences = input.preferences
    if ((input.action === 'preferences' || (input.action === 'subscribe' && preferences !== undefined))
      && (!preferences || typeof preferences.visits !== 'boolean' || typeof preferences.accounts !== 'boolean')) {
      return json({ error: 'Märguannete valikud on vigased.' }, 400)
    }
    const preferenceFields = preferences && ['subscribe', 'preferences'].includes(input.action)
      ? { visits_enabled: preferences.visits, accounts_enabled: preferences.accounts } : {}
    const subscription = input.action === 'subscribe' ? parsePushSubscription(input.subscription) : null
    const endpoint = subscription?.endpoint ?? input.endpoint
    if (!validPushEndpoint(endpoint) || (input.action === 'subscribe' && !subscription)) return json({ error: 'Seadme märguannete andmed on vigased.' }, 400)
    const { data: existing, error: readError } = await admin.from('admin_push_subscriptions').select('id, endpoint, p256dh, auth, visits_enabled, accounts_enabled').eq('endpoint', endpoint).eq('user_id', user.id).maybeSingle()
    if (readError) throw new Error('Subscription lookup failed')
    const savedPreferences = { visits: existing?.visits_enabled ?? true, accounts: existing?.accounts_enabled ?? true }
    if (input.action === 'status') return json({ enabled: Boolean(existing), preferences: savedPreferences })
    if (input.action === 'preferences') {
      if (!existing) return json({ error: 'Luba esmalt selles seadmes märguanded.' }, 404)
      const { error } = await admin.from('admin_push_subscriptions').update(preferenceFields).eq('id', existing.id).eq('user_id', user.id)
      if (error) throw new Error('Preferences update failed')
      return json({ enabled: true, preferences: { visits: preferences.visits, accounts: preferences.accounts } })
    }
    if (input.action === 'unsubscribe') {
      const { error } = await admin.from('admin_push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', user.id)
      if (error) throw new Error('Subscription removal failed')
      return json({ enabled: false })
    }
    if (!config) return json({ error: 'Telefoni märguanded pole veel seadistatud.' }, 503)
    if (input.action === 'subscribe' && subscription) {
      if (!existing) {
        const { count, error: countError } = await admin.from('admin_push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
        if (countError) throw new Error('Subscription count failed')
        if ((count ?? 0) >= 20) return json({ error: 'Seadmete limiit on täis. Lülita mõnes teises seadmes märguanded välja.' }, 409)
        const { error } = await admin.from('admin_push_subscriptions').insert({ user_id: user.id, endpoint, ...subscription.keys, ...preferenceFields })
        if (error) return json({ error: 'Seadme sidumine ebaõnnestus. Lülita brauseri märguanded välja ja proovi uuesti.' }, 409)
      } else {
        const { error } = await admin.from('admin_push_subscriptions').update({ ...subscription.keys, ...preferenceFields }).eq('id', existing.id).eq('user_id', user.id)
        if (error) throw new Error('Subscription update failed')
      }
      return json({ enabled: true, preferences: preferences ? { visits: preferences.visits, accounts: preferences.accounts } : savedPreferences })
    }
    if (!existing) return json({ error: 'Luba esmalt selles seadmes märguanded.' }, 404)
    const outcome = await sendAdminPush({ endpoint: existing.endpoint, keys: { p256dh: existing.p256dh, auth: existing.auth } }, pushNotice('test', crypto.randomUUID()))
    if (outcome === 'gone') {
      await admin.from('admin_push_subscriptions').delete().eq('id', existing.id)
      return json({ error: 'Seadme märguannete luba on aegunud. Lülita märguanded uuesti sisse.' }, 410)
    }
    return outcome === 'sent' ? json({ sent: true }) : json({ error: 'Prooviteavitust ei õnnestunud saata. Proovi uuesti.' }, 503)
  } catch {
    return json({ error: 'Märguannete toiming ebaõnnestus. Proovi uuesti.' }, 500)
  }
})
