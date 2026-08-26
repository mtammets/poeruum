/* global URL */

export const STRIPE_REQUIREMENT_ACTION_URL = 'https://poeruum.ee/?stripe_requirements=1'

export const STRIPE_REQUIREMENT_EMAIL_KINDS = Object.freeze([
  'action_required',
  'deadline_7d',
  'deadline_1d',
  'past_due',
  'disabled',
])

const EMAIL_KIND_SET = new Set(STRIPE_REQUIREMENT_EMAIL_KINDS)
const ESTONIAN_MONTHS_BEFORE = [
  'jaanuari',
  'veebruari',
  'märtsi',
  'aprilli',
  'maid',
  'juunit',
  'juulit',
  'augustit',
  'septembrit',
  'oktoobrit',
  'novembrit',
  'detsembrit',
]
const ESTONIAN_MONTHS_BY = [
  'jaanuariks',
  'veebruariks',
  'märtsiks',
  'aprilliks',
  'maiks',
  'juuniks',
  'juuliks',
  'augustiks',
  'septembriks',
  'oktoobriks',
  'novembriks',
  'detsembriks',
]

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const safeStoreName = (value) => String(value ?? '')
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 100) || 'Sinu pood'

const safeActionUrl = (value) => {
  let url
  try {
    url = new URL(value || STRIPE_REQUIREMENT_ACTION_URL)
  } catch {
    throw new Error('Stripe’i andmete täiendamise link ei ole korrektne URL.')
  }
  if (url.origin !== 'https://poeruum.ee' || url.username || url.password) {
    throw new Error('Stripe’i andmete täiendamise link peab asuma aadressil https://poeruum.ee.')
  }
  return url.toString()
}

const deadlineParts = (value) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth(),
    year: date.getUTCFullYear(),
  }
}

const requirementCount = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export const stripeRequirementEmailNeedsAction = (requirements = {}) =>
  requirementCount(requirements.dueCount) > 0
  || requirements.pastDue === true
  || (typeof requirements.disabledReason === 'string' && requirements.disabledReason.trim().length > 0)

const copyForKind = (kind, storeName, deadline) => {
  const deadlineDate = deadlineParts(deadline)
  const deadlineBefore = deadlineDate
    ? `${deadlineDate.day}. ${ESTONIAN_MONTHS_BEFORE[deadlineDate.month]} ${deadlineDate.year}`
    : null
  const deadlineBy = deadlineDate
    ? `${deadlineDate.day}. ${ESTONIAN_MONTHS_BY[deadlineDate.month]} ${deadlineDate.year}`
    : null
  const partnerIntro = 'Stripe on Poeruumi maksepartner. Selle kaudu saavad ostjad maksta kaardi, Apple Pay või Google Payga ning Stripe kannab müügitulu sinu kontole. Et maksed oleksid turvalised ja vastaksid seadustele, kontrollib Stripe aeg-ajalt ettevõtte ja selle esindaja andmeid.'
  const confirmDetail = deadlineBy
    ? `Poe „${storeName}” puhul on vaja ettevõtte andmed üle vaadata. Kinnita need hiljemalt ${deadlineBy}, et maksed ja väljamaksed saaksid jätkuda.`
    : `Poe „${storeName}” puhul on vaja ettevõtte andmed üle vaadata. Kinnita need esimesel võimalusel, et maksed ja väljamaksed saaksid jätkuda.`

  if (kind === 'deadline_7d') {
    return {
      subject: `Kinnita ettevõtte andmed 7 päeva jooksul · ${storeName}`,
      title: 'Ettevõtte andmete kinnitamiseks on jäänud 7 päeva',
      intro: partnerIntro,
      detail: confirmDetail,
      action: 'Kinnita andmed Poeruumis',
      accent: '#ffb45f',
    }
  }
  if (kind === 'deadline_1d') {
    return {
      subject: `Kinnita ettevõtte andmed hiljemalt homme · ${storeName}`,
      title: 'Ettevõtte andmete kinnitamiseks on jäänud 1 päev',
      intro: partnerIntro,
      detail: confirmDetail,
      action: 'Kinnita andmed Poeruumis',
      accent: '#ff9a62',
    }
  }
  if (kind === 'past_due') {
    return {
      subject: `Ettevõtte andmete kinnitamise tähtaeg on möödas · ${storeName}`,
      title: 'Ettevõtte andmete kinnitamise tähtaeg on möödas',
      intro: partnerIntro,
      detail: `Poe „${storeName}” ettevõtte andmed on endiselt kinnitamata. Kinnita need kohe; kuni kontrolli lõpetamiseni võib Stripe piirata maksete vastuvõtmist või raha väljamaksmist.`,
      action: 'Kinnita andmed kohe',
      accent: '#ff7d65',
    }
  }
  if (kind === 'disabled') {
    return {
      subject: `Maksekonto piirangu lahendamiseks kinnita ettevõtte andmed · ${storeName}`,
      title: 'Maksekonto piirangu lahendamiseks kinnita ettevõtte andmed',
      intro: partnerIntro,
      detail: `Poe „${storeName}” maksekonto kasutamine on piiratud, sest ettevõtte andmed vajavad kinnitamist. Kinnita need kohe. Pärast esitamist vaatab Stripe info üle ja otsustab, millal saab piirangu eemaldada.`,
      action: 'Kinnita andmed kohe',
      accent: '#ff675f',
    }
  }
  return {
    subject: `${deadlineBefore ? `Kinnita ettevõtte andmed enne ${deadlineBefore}` : 'Kinnita ettevõtte andmed'} · ${storeName}`,
    title: 'Maksete jätkamiseks kinnita ettevõtte andmed',
    intro: partnerIntro,
    detail: confirmDetail,
    action: 'Kinnita andmed Poeruumis',
    accent: '#ffb45f',
  }
}

/**
 * Renders a transactional Stripe requirements message. Pending verification by
 * itself returns null so callers cannot accidentally ask a merchant to repeat
 * an action that Stripe is already reviewing.
 */
export const renderStripeRequirementEmail = (input) => {
  if (!input || !EMAIL_KIND_SET.has(input.kind)) {
    throw new Error('Tundmatu Stripe’i nõuete e-kirja tüüp.')
  }
  if (!stripeRequirementEmailNeedsAction(input.requirements)) return null

  const storeName = safeStoreName(input.storeName)
  const actionUrl = safeActionUrl(input.actionUrl)
  const copy = copyForKind(input.kind, storeName, input.deadline)
  const subject = `${input.preview ? '[Eelvaade] ' : ''}${copy.subject}`
  const explanation = 'Logi Poeruumi sisse ja järgi Stripe’i vormis näidatud samme. Vorm avaneb Poeruumis ning andmed saadetakse otse Stripe’ile. Poeruum ei näe ega salvesta sinu isikut tõendava dokumendi sisu.'
  const security = 'Ära vasta sellele kirjale isikut tõendava dokumendi, parooli ega Smart-ID või PIN-koodidega. Poeruum ei küsi neid e-kirja teel.'
  const previewNotice = input.preview
    ? 'See on kujunduse eelvaade fiktiivse poe andmetega. Päris kaupmehele kirja ei saadetud ja ühegi konto seadeid ei muudeta.'
    : ''
  const html = `<!doctype html>
<html lang="et"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1efe9;color:#23221f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(copy.detail)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1efe9"><tr><td align="center" style="padding:40px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
      <tr><td style="padding:0 4px 20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:11px"><img src="https://poeruum.ee/images/poeruum-email-logo.png?v=2" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;border-radius:11px"></td><td style="font-size:18px;font-weight:800;letter-spacing:-.055em;color:#17231c;white-space:nowrap">Poe<span style="color:#265f43;font-weight:600">ruum</span></td></tr></table></td></tr>
      <tr><td style="overflow:hidden;border-radius:22px;background:#ffffff;box-shadow:0 10px 35px rgba(34,31,25,.08)">
        <div style="height:8px;background:${copy.accent}"></div>
        <div style="padding:38px 38px 34px">
          <div style="margin-bottom:12px;color:#77736a;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Maksed · vajab tegevust</div>
          <h1 style="margin:0 0 16px;color:#171714;font-size:30px;line-height:1.2;letter-spacing:-.03em">${escapeHtml(copy.title)}</h1>
          <p style="margin:0;color:#56534d;font-size:16px;line-height:1.65">${escapeHtml(copy.intro)}</p>
          <div style="margin:24px 0;padding:20px;border-radius:14px;background:#f6f4ef;color:#666159;font-size:14px;line-height:1.6">${escapeHtml(copy.detail)}</div>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#171714">
            <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">${escapeHtml(copy.action)} &nbsp;→</a>
          </td></tr></table>
          <p style="margin:24px 0 0;color:#666159;font-size:14px;line-height:1.65">${escapeHtml(explanation)}</p>
          <div style="margin-top:22px;padding:16px 18px;border-radius:12px;background:#fff7e8;color:#6f5837;font-size:13px;line-height:1.6"><strong style="color:#4e3b23">Turvalisus</strong><br>${escapeHtml(security)}</div>
          ${previewNotice ? `<p style="margin:22px 0 0;color:#8a857d;font-size:12px;line-height:1.6">${escapeHtml(previewNotice)}</p>` : ''}
        </div>
      </td></tr>
      <tr><td style="padding:22px 4px 0;color:#8a857d;font-size:12px;line-height:1.6">Poeruum · sinu e-pood 10 minutiga<br>See on oluline teenuseteade sinu poe maksekonto kohta.<br>Küsimuste korral kirjuta aadressile info@poeruum.ee.</td></tr>
    </table>
  </td></tr></table>
</body></html>`
  const text = [
    copy.title,
    copy.intro,
    copy.detail,
    `${copy.action}: ${actionUrl}`,
    explanation,
    `Turvalisus: ${security}`,
    previewNotice,
    'See on oluline teenuseteade sinu poe maksekonto kohta.',
    'Küsimuste korral kirjuta aadressile info@poeruum.ee.',
  ].filter(Boolean).join('\n\n')

  return { subject, html, text }
}
