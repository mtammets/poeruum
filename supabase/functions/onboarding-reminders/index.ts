import { createClient } from 'npm:@supabase/supabase-js@2'

type ReminderClaim = {
  user_id: string
  email: string
  store_name: string
  onboarding_step: 'store' | 'business' | 'payments' | 'shipping' | 'publish'
  reminder_number: 1 | 2
  unsubscribe_token: string
}

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const stepCopy: Record<ReminderClaim['onboarding_step'], { label: string; detail: string }> = {
  store: { label: 'Lisa poe nimi ja aadress', detail: 'Alusta poe põhiandmetest. Kõik järgmised sammud saad hiljem üle vaadata.' },
  business: { label: 'Lisa müüja andmed', detail: 'Täida ettevõtte kontakt- ja registriandmed, mida kliendid sinu poes näevad.' },
  payments: { label: 'Seadista maksed', detail: 'Et kliendid saaksid sinu poes mugavalt ja turvaliselt maksta.' },
  shipping: { label: 'Vali tarneviisid', detail: 'Määra pakiautomaadid, kuller või järeletulemine ja nende hinnad.' },
  publish: { label: 'Vaata andmed üle ja avalda pood', detail: 'Sinu poe põhiandmed on valmis. Kontrolli kokkuvõtet ja avalda pood.' },
}

const renderEmail = (claim: ReminderClaim, appUrl: string) => {
  const step = stepCopy[claim.onboarding_step]
  const continueUrl = `${appUrl}/?continue_setup=1`
  const stopUrl = `${appUrl}/?onboarding_reminders=off&token=${encodeURIComponent(claim.unsubscribe_token)}`
  const title = claim.reminder_number === 1 ? 'Poe seadistamine jäi pooleli?' : 'Kas teeme su poe valmis?'
  const subject = claim.reminder_number === 1 ? 'Sinu pood jäi pooleli — kõik on alles' : 'Kas teeme su poe valmis?'
  const intro = claim.reminder_number === 1
    ? 'Kõik, mis juba tegid, on alles.'
    : 'Kõik, mis juba tegid, on alles. Kui soovid jätkata, saad alustada täpselt poolelijäänud sammust.'
  const note = claim.reminder_number === 1
    ? 'Pole kiiret — jätka siis, kui sulle sobib.'
    : 'See on viimane meeldetuletus. Kui praegu pole õige aeg, on kõik hästi.'
  const html = `<!doctype html>
<html lang="et"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1efe9;color:#23221f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(step.label)} · kõik salvestatud andmed on alles.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1efe9"><tr><td align="center" style="padding:40px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
      <tr><td style="padding:0 4px 20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:11px"><img src="${appUrl}/images/poeruum-email-logo.png?v=2" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;border-radius:11px"></td><td style="font-family:Manrope,'Segoe UI',Arial,sans-serif;font-size:18px;font-weight:800;letter-spacing:-.055em;color:#17231c;white-space:nowrap">Poe<span style="color:#265f43;font-weight:600">ruum</span></td></tr></table></td></tr>
      <tr><td style="overflow:hidden;border-radius:22px;background:#ffffff;box-shadow:0 10px 35px rgba(34,31,25,.08)">
        <div style="height:8px;background:#d9ff43"></div>
        <div style="padding:38px 38px 34px">
          <h1 style="margin:0 0 16px;color:#171714;font-size:30px;line-height:1.2;letter-spacing:-.03em">${escapeHtml(title)}</h1>
          <p style="margin:0;color:#56534d;font-size:16px;line-height:1.65">${escapeHtml(intro)}</p>
          <div style="margin:26px 0 4px;padding:20px;border-radius:14px;background:#f6f4ef">
            <span style="display:block;margin-bottom:6px;color:#77736a;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">Järgmine samm</span>
            <strong style="display:block;color:#23221f;font-size:18px">${escapeHtml(step.label)}</strong>
            <span style="display:block;margin-top:7px;color:#666159;font-size:14px;line-height:1.55">${escapeHtml(step.detail)}</span>
          </div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 24px"><tr><td style="border-radius:999px;background:#171714">
            <a href="${continueUrl}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">Jätka seadistamist &nbsp;→</a>
          </td></tr></table>
          <p style="margin:0;color:#8a857d;font-size:12px;line-height:1.55">${escapeHtml(note)}</p>
        </div>
      </td></tr>
      <tr><td style="padding:22px 4px 0;color:#8a857d;font-size:12px;line-height:1.6">Poeruum · sinu e-pood 10 minutiga<br><a href="${stopUrl}" style="color:#77736a">Ma ei soovi rohkem meeldetuletusi</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`
  const text = `${title}\n\n${intro}\n\nJärgmine samm: ${step.label}\n${step.detail}\n\nJätka: ${continueUrl}\n\nMeeldetuletustest loobumine: ${stopUrl}`
  return { subject, html, text }
}

const sendReminder = async (claim: ReminderClaim) => {
  const appUrl = requiredEnv('APP_URL').replace(/\/$/, '')
  const email = renderEmail(claim, appUrl)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      'User-Agent': 'poeruum-onboarding-reminders/1.0',
      'Idempotency-Key': `onboarding-${claim.user_id}-${claim.reminder_number}`,
    },
    body: JSON.stringify({
      from: Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'Poeruum <teavitused@send.poeruum.ee>',
      to: [claim.email],
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: [
        { name: 'email_type', value: 'onboarding_reminder' },
        { name: 'reminder_number', value: String(claim.reminder_number) },
      ],
    }),
  })
  if (!response.ok) throw new Error(`Resend vastas ${response.status}: ${await response.text()}`)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (request.headers.get('Authorization') !== `Bearer ${requiredEnv('ONBOARDING_CRON_SECRET')}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  let sent = 0
  let failed = 0

  for (let index = 0; index < 50; index += 1) {
    const { data, error } = await admin.rpc('claim_onboarding_reminder')
    if (error) return json({ error: 'Reminder claim failed' }, 500)
    const claim = (data?.[0] ?? null) as ReminderClaim | null
    if (!claim) break

    try {
      await sendReminder(claim)
      const { error: completeError } = await admin.rpc('complete_onboarding_reminder_claim', {
        target_user_id: claim.user_id,
        target_reminder: claim.reminder_number,
      })
      if (completeError) throw completeError
      sent += 1
    } catch (sendError) {
      failed += 1
      console.error(`Onboardingu meeldetuletus kasutajale ${claim.user_id} ebaõnnestus.`, sendError)
      await admin.rpc('release_onboarding_reminder_claim', {
        target_user_id: claim.user_id,
        target_reminder: claim.reminder_number,
      })
    }
  }

  return json({ sent, failed })
})
