import process from 'node:process'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const recipient = process.argv[2]?.trim().toLowerCase()
if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
  throw new Error('Kasutus: npm run supabase:onboarding-email:preview -- nimi@example.com')
}

const render = ({ title, intro, step, detail, final }) => `<!doctype html>
<html lang="et"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1efe9;color:#23221f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${step} · kõik salvestatud andmed on alles.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1efe9"><tr><td align="center" style="padding:40px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
      <tr><td style="padding:0 4px 20px;font-size:21px;font-weight:800;letter-spacing:.13em;color:#171714">POERUUM</td></tr>
      <tr><td style="overflow:hidden;border-radius:22px;background:#ffffff;box-shadow:0 10px 35px rgba(34,31,25,.08)">
        <div style="height:8px;background:#d9ff43"></div>
        <div style="padding:38px 38px 34px">
          <div style="margin-bottom:14px;color:#77736a;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Poe seadistamine</div>
          <h1 style="margin:0 0 16px;color:#171714;font-size:30px;line-height:1.2;letter-spacing:-.03em">${title}</h1>
          <p style="margin:0;color:#56534d;font-size:16px;line-height:1.65">${intro}</p>
          <div style="margin:26px 0 4px;padding:20px;border-radius:14px;background:#f6f4ef">
            <span style="display:block;margin-bottom:6px;color:#77736a;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">Järgmine samm</span>
            <strong style="display:block;color:#23221f;font-size:18px">${step}</strong>
            <span style="display:block;margin-top:7px;color:#666159;font-size:14px;line-height:1.55">${detail}</span>
          </div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 24px"><tr><td style="border-radius:999px;background:#171714">
            <a href="https://poeruum.ee" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">Jätka poe seadistamist &nbsp;→</a>
          </td></tr></table>
          <p style="margin:0;color:#8a857d;font-size:12px;line-height:1.55">See on ${final ? 'viimane ' : ''}meeldetuletus sinu alustatud poe seadistamise kohta.</p>
        </div>
      </td></tr>
      <tr><td style="padding:22px 4px 0;color:#8a857d;font-size:12px;line-height:1.6">Poeruum · sinu e-pood 10 minutiga<br><a href="https://poeruum.ee" style="color:#77736a">Ära saada mulle poe seadistamise meeldetuletusi</a><br><span style="color:#aaa59d">Eelvaade — lingid ei muuda konto seadeid.</span></td></tr>
    </table>
  </td></tr></table>
</body></html>`

const previews = [
  {
    subject: '[Eelvaade 1/2] Sinu poe seadistamine jäi pooleli',
    html: render({
      title: 'Sinu poe seadistamine jäi pooleli',
      intro: 'Kõik seni sisestatud andmed on alles. Jätka rahulikult sealt, kus pooleli jäid.',
      step: 'Ühenda makseteenus',
      detail: 'Ühenda maksete vastuvõtmine, et kliendid saaksid sinu poes turvaliselt tasuda.',
      final: false,
    }),
    number: '1',
  },
  {
    subject: '[Eelvaade 2/2] Sinu pood ootab viimast sammu',
    html: render({
      title: 'Sinu pood ootab viimast sammu',
      intro: 'Poeruumi seadistus on endiselt alles. Kui soovid poe valmis teha, saad jätkata täpselt poolelijäänud sammust.',
      step: 'Vaata andmed üle ja avalda pood',
      detail: 'Sinu poe põhiandmed on valmis. Kontrolli kokkuvõtet ja avalda pood.',
      final: true,
    }),
    number: '2',
  },
]

for (const preview of previews) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${required('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      'User-Agent': 'poeruum-onboarding-preview/1.0',
    },
    body: JSON.stringify({
      from: 'Poeruum <teavitused@send.poeruum.ee>',
      to: [recipient],
      subject: preview.subject,
      html: preview.html,
      tags: [
        { name: 'email_type', value: 'preview_onboarding_reminder' },
        { name: 'reminder_number', value: preview.number },
      ],
    }),
  })
  if (!response.ok) throw new Error(`Resend vastas ${response.status}: ${await response.text()}`)
  console.log(`${preview.subject}: saadetud`)
}
