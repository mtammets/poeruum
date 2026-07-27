import { createClient } from 'npm:@supabase/supabase-js@2'

type Snapshot = {
  recent_errors?: number
  recent_critical_errors?: number
  failed_cron_runs?: number
}

type AlertState = {
  alert_key: string
  status: 'open' | 'resolved'
  last_alerted_at: string | null
}

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;')

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (request.headers.get('Authorization') !== `Bearer ${requiredEnv('ONBOARDING_CRON_SECRET')}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const now = new Date()
  const appUrl = requiredEnv('APP_URL').replace(/\/$/, '')
  const notificationEmail = requiredEnv('SUPPORT_NOTIFICATION_EMAIL')
  const resendApiKey = requiredEnv('RESEND_API_KEY')
  const from = requiredEnv('RESEND_FROM_EMAIL')
  const results: Record<string, string> = {}

  const sendEmail = async (subject: string, summary: string, recovered: boolean) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'poeruum-health-monitor/1.0',
      },
      body: JSON.stringify({
        from,
        to: [notificationEmail],
        subject,
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px"><h1 style="font-size:24px">${escapeHtml(subject)}</h1><p style="line-height:1.6">${escapeHtml(summary)}</p><p style="color:#777">Aeg: ${now.toISOString()} · Keskkond: production · Olek: ${recovered ? 'taastunud' : 'vajab tähelepanu'}</p></div>`,
        text: `${subject}\n\n${summary}\n\nAeg: ${now.toISOString()}\nKeskkond: production`,
        tags: [{ name: 'email_type', value: recovered ? 'monitor_recovery' : 'monitor_alert' }],
      }),
    })
    if (!response.ok) throw new Error(`Resend vastas ${response.status}.`)
  }

  const updateAlert = async (key: string, failing: boolean, summary: string) => {
    const { data, error } = await admin.from('monitor_alert_states')
      .select('alert_key,status,last_alerted_at')
      .eq('alert_key', key)
      .maybeSingle()
    if (error) throw error
    const state = data as AlertState | null
    const shouldRepeat = state?.last_alerted_at
      ? now.getTime() - new Date(state.last_alerted_at).getTime() >= 60 * 60 * 1000
      : true

    if (failing && (state?.status !== 'open' || shouldRepeat)) {
      await sendEmail(`Poeruumi alarm: ${key}`, summary, false)
    } else if (!failing && state?.status === 'open') {
      await sendEmail(`Poeruum taastus: ${key}`, summary, true)
    }

    const alertUpdate: Record<string, string | null> = {
      alert_key: key,
      status: failing ? 'open' : 'resolved',
      summary,
      last_checked_at: now.toISOString(),
      last_alerted_at: failing && (state?.status !== 'open' || shouldRepeat)
        ? now.toISOString()
        : state?.last_alerted_at ?? null,
      resolved_at: failing ? null : now.toISOString(),
    }
    if (failing && state?.status !== 'open') alertUpdate.first_failed_at = now.toISOString()
    if (!failing) alertUpdate.first_failed_at = null

    const { error: upsertError } = await admin.from('monitor_alert_states')
      .upsert(alertUpdate, { onConflict: 'alert_key' })
    if (upsertError) throw upsertError
    results[key] = failing ? 'open' : 'ok'
  }

  try {
    let siteFailure = ''
    try {
      const response = await fetch(`${appUrl}/`, {
        headers: { 'User-Agent': 'poeruum-health-monitor/1.0' },
        signal: AbortSignal.timeout(10_000),
      })
      const body = await response.text()
      if (!response.ok || !body.includes('id="root"')) {
        siteFailure = `Avaleht vastas olekuga ${response.status} või ei sisaldanud rakenduse juurelementi.`
      }
    } catch (error) {
      siteFailure = error instanceof Error ? error.message : 'Avalehe päring ebaõnnestus.'
    }
    await updateAlert('avalik-veeb', Boolean(siteFailure), siteFailure || 'Poeruumi avaleht vastab korrektselt.')

    const { data, error } = await admin.rpc('monitor_system_snapshot', {
      reference_time: now.toISOString(),
    })
    if (error) throw error
    const snapshot = (data ?? {}) as Snapshot
    const errorCount = Number(snapshot.recent_errors ?? 0)
    const criticalCount = Number(snapshot.recent_critical_errors ?? 0)
    const cronFailures = Number(snapshot.failed_cron_runs ?? 0)
    await updateAlert(
      'rakenduse-vead',
      errorCount >= 5 || criticalCount >= 1,
      `Viimase 5 minuti vead: ${errorCount}; viimase 15 minuti kriitilised vead: ${criticalCount}.`,
    )
    await updateAlert(
      'taustatööd',
      cronFailures >= 1,
      `Viimase 15 minuti ebaõnnestunud pg_cron tööd: ${cronFailures}.`,
    )

    await admin.rpc('cleanup_security_observability', { reference_time: now.toISOString() })
    return json({ status: 'ok', checks: results })
  } catch (error) {
    console.error('Poeruumi tervisemonitor ebaõnnestus.', error)
    return json({ error: 'Tervisemonitor ebaõnnestus.' }, 500)
  }
})
