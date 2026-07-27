import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type BillingEmailKind = 'payment_failed' | 'grace_reminder' | 'downgraded'

export type BillingEmailStore = {
  id: string
  owner_id: string | null
  name: string
  billing_grace_ends_at: string | null
  billing_last_failed_invoice_id: string | null
  billing_last_failed_invoice_url: string | null
}

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value))
  : ''

const emailCopy = (kind: BillingEmailKind, store: BillingEmailStore) => {
  const deadline = formatDate(store.billing_grace_ends_at)
  if (kind === 'payment_failed') {
    return {
      subject: `Kindla paketi makse ebaõnnestus · ${store.name}`,
      title: 'Kindla paketi makse ebaõnnestus',
      intro: `Stripe ei saanud poe „${store.name}” kuutasu valitud makseviisilt võtta.`,
      detail: `Kindla paketi 0% müügitasu kehtib ${deadline ? `${deadline} lõpuni` : '7 päeva'}. Kui makse selleks ajaks ei õnnestu, liigub pood automaatselt Paindlikule paketile ja jääb avatuks.`,
      action: 'Paranda makse',
    }
  }
  if (kind === 'grace_reminder') {
    return {
      subject: `Kindla paketi armuaeg lõpeb peagi · ${store.name}`,
      title: 'Makse parandamiseks on jäänud vähem kui päev',
      intro: `Poe „${store.name}” Kindla paketi makse on endiselt tasumata.`,
      detail: `Kui makse ei õnnestu ${deadline ? `${deadline} lõpuks` : 'armuaja lõpuks'}, rakendub automaatselt Paindlik pakett. Pood jääb avatuks ning uutelt müükidelt arvestatakse 4% + käibemaks.`,
      action: 'Maksa arve',
    }
  }
  return {
    subject: `Pood liikus Paindlikule paketile · ${store.name}`,
    title: 'Paindlik pakett on nüüd aktiivne',
    intro: `Poe „${store.name}” Kindla paketi makse ei õnnestunud armuaja jooksul.`,
    detail: 'Pood jäi avatuks. Edaspidistele müükidele rakendub Paindliku paketi tasu 4% + käibemaks ning Kindla paketi tasumata kuuarve tühistati.',
    action: 'Vaata arveldust',
  }
}

export const sendBillingEmail = async (
  admin: SupabaseClient,
  store: BillingEmailStore,
  kind: BillingEmailKind,
) => {
  if (!store.owner_id) return
  const { data, error } = await admin.auth.admin.getUserById(store.owner_id)
  if (error) throw error
  const recipient = data.user?.email?.trim()
  if (!recipient) return

  const appUrl = requiredEnv('APP_URL').replace(/\/$/, '')
  const copy = emailCopy(kind, store)
  const actionUrl = kind !== 'downgraded' && store.billing_last_failed_invoice_url
    ? store.billing_last_failed_invoice_url
    : `${appUrl}/?billing=manage`
  const html = `<!doctype html>
<html lang="et"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1efe9;color:#23221f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(copy.intro)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1efe9"><tr><td align="center" style="padding:40px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
      <tr><td style="padding:0 4px 20px"><img src="${appUrl}/images/poeruum-email-logo.png?v=2" width="40" height="40" alt="Poeruum" style="display:block;width:40px;height:40px;border:0;border-radius:11px"></td></tr>
      <tr><td style="overflow:hidden;border-radius:22px;background:#ffffff;box-shadow:0 10px 35px rgba(34,31,25,.08)">
        <div style="height:8px;background:${kind === 'downgraded' ? '#d9ff43' : '#ffb45f'}"></div>
        <div style="padding:38px 38px 34px">
          <div style="margin-bottom:12px;color:#77736a;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Arveldus</div>
          <h1 style="margin:0 0 16px;color:#171714;font-size:30px;line-height:1.2;letter-spacing:-.03em">${escapeHtml(copy.title)}</h1>
          <p style="margin:0;color:#56534d;font-size:16px;line-height:1.65">${escapeHtml(copy.intro)}</p>
          <div style="margin:24px 0;padding:20px;border-radius:14px;background:#f6f4ef;color:#666159;font-size:14px;line-height:1.6">${escapeHtml(copy.detail)}</div>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#171714">
            <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">${escapeHtml(copy.action)} &nbsp;→</a>
          </td></tr></table>
        </div>
      </td></tr>
      <tr><td style="padding:22px 4px 0;color:#8a857d;font-size:12px;line-height:1.6">Poeruum · sinu e-pood 10 minutiga<br>Küsimuste korral kirjuta aadressile info@poeruum.ee.</td></tr>
    </table>
  </td></tr></table>
</body></html>`
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      'User-Agent': 'poeruum-billing/1.0',
      'Idempotency-Key': `billing-${kind}-${store.id}-${store.billing_last_failed_invoice_id ?? 'subscription'}`,
    },
    body: JSON.stringify({
      from: Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'Poeruum <teavitused@send.poeruum.ee>',
      to: [recipient],
      subject: copy.subject,
      html,
      text: `${copy.title}\n\n${copy.intro}\n\n${copy.detail}\n\n${copy.action}: ${actionUrl}`,
      tags: [
        { name: 'email_type', value: `billing_${kind}` },
        { name: 'store_id', value: store.id },
      ],
    }),
  })
  if (!response.ok) throw new Error(`Resend vastas ${response.status}: ${await response.text()}`)
}
