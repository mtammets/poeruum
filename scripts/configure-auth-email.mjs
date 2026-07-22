import process from 'node:process'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const button = (label, href = '{{ .ConfirmationURL }}') => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 24px">
    <tr><td style="border-radius:999px;background:#171714">
      <a href="${href}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">${label} &nbsp;→</a>
    </td></tr>
  </table>`

const card = ({ preview, eyebrow, title, intro, action = '', detail = '', fallback = true }) => `<!doctype html>
<html lang="et">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1efe9;color:#23221f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${preview}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1efe9">
    <tr><td align="center" style="padding:40px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
        <tr><td style="padding:0 4px 20px;font-size:21px;font-weight:800;letter-spacing:.13em;color:#171714">POERUUM</td></tr>
        <tr><td style="overflow:hidden;border-radius:22px;background:#ffffff;box-shadow:0 10px 35px rgba(34,31,25,.08)">
          <div style="height:8px;background:#d9ff43"></div>
          <div style="padding:38px 38px 34px">
            <div style="margin-bottom:14px;color:#77736a;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">${eyebrow}</div>
            <h1 style="margin:0 0 16px;color:#171714;font-size:30px;line-height:1.2;letter-spacing:-.03em">${title}</h1>
            <p style="margin:0;color:#56534d;font-size:16px;line-height:1.65">${intro}</p>
            ${action}
            ${detail ? `<div style="margin-top:24px;padding:18px 20px;border-radius:14px;background:#f6f4ef;color:#666159;font-size:14px;line-height:1.55">${detail}</div>` : ''}
            ${fallback ? `<p style="margin:26px 0 0;color:#8a857d;font-size:12px;line-height:1.55">Kui nupp ei avane, kopeeri see aadress brauserisse:<br><a href="{{ .ConfirmationURL }}" style="color:#55514b;word-break:break-all">{{ .ConfirmationURL }}</a></p>` : ''}
          </div>
        </td></tr>
        <tr><td style="padding:22px 4px 0;color:#8a857d;font-size:12px;line-height:1.6">Poeruum · sinu e-pood 10 minutiga<br>Kui sina seda toimingut ei alustanud, võid kirja tähelepanuta jätta.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

const templates = {
  mailer_subjects_confirmation: 'Kinnita oma Poeruumi konto',
  mailer_templates_confirmation_content: card({
    preview: 'Kinnita oma e-posti aadress ja alusta Poeruumi kasutamist.',
    eyebrow: 'Tere tulemast Poeruumi',
    title: 'Kinnita oma e-posti aadress',
    intro: 'Üks viimane samm ja sinu Poeruumi konto on kasutamiseks valmis.',
    action: button('Kinnita e-post'),
    detail: 'Kinnituslink kehtib piiratud aja ja seda saab kasutada ainult ühe korra.',
  }),
  mailer_subjects_recovery: 'Taasta oma Poeruumi parool',
  mailer_templates_recovery_content: card({
    preview: 'Kasuta turvalist linki uue parooli määramiseks.',
    eyebrow: 'Parooli taastamine',
    title: 'Määra uus parool',
    intro: 'Saime taotluse sinu Poeruumi konto parooli muutmiseks. Turvalise jätkamise jaoks kasuta allolevat nuppu.',
    action: button('Muuda parooli'),
    detail: 'Kui sina parooli taastamist ei taotlenud, pole vaja midagi teha.',
  }),
  mailer_subjects_email_change: 'Kinnita uus e-posti aadress',
  mailer_templates_email_change_content: card({
    preview: 'Kinnita oma Poeruumi konto uus e-posti aadress.',
    eyebrow: 'Konto turvalisus',
    title: 'Kinnita uus e-posti aadress',
    intro: 'Sinu Poeruumi konto uueks aadressiks sooviti määrata <strong style="color:#23221f">{{ .NewEmail }}</strong>. Muudatuse kinnitamiseks kasuta allolevat nuppu.',
    action: button('Kinnita uus aadress'),
  }),
  mailer_subjects_magic_link: 'Sinu Poeruumi sisselogimislink',
  mailer_templates_magic_link_content: card({
    preview: 'Logi turvalise lingiga Poeruumi sisse.',
    eyebrow: 'Turvaline sisselogimine',
    title: 'Logi Poeruumi sisse',
    intro: 'Kasuta allolevat ühekordset linki oma Poeruumi kontole sisselogimiseks.',
    action: button('Logi sisse'),
  }),
  mailer_subjects_invite: 'Sind kutsuti Poeruumi',
  mailer_templates_invite_content: card({
    preview: 'Sulle saadeti kutse Poeruumiga liitumiseks.',
    eyebrow: 'Kutse',
    title: 'Alusta Poeruumi kasutamist',
    intro: 'Sulle on loodud kutse Poeruumiga liitumiseks. Konto aktiveerimiseks kasuta allolevat nuppu.',
    action: button('Võta kutse vastu'),
  }),
  mailer_subjects_reauthentication: '{{ .Token }} on sinu Poeruumi kinnituskood',
  mailer_templates_reauthentication_content: card({
    preview: 'Sinu ühekordne Poeruumi kinnituskood.',
    eyebrow: 'Konto turvalisus',
    title: 'Sinu kinnituskood',
    intro: 'Sisesta see ühekordne kood Poeruumis, et tundlik toiming turvaliselt kinnitada.',
    action: '<div style="margin:28px 0 8px;padding:20px;border-radius:14px;background:#171714;color:#ffffff;text-align:center;font-size:30px;font-weight:800;letter-spacing:.22em">{{ .Token }}</div>',
    detail: 'Ära jaga seda koodi kellegagi. Poeruum ei küsi seda sinult e-posti ega telefoni teel.',
    fallback: false,
  }),
}

const response = await fetch(`https://api.supabase.com/v1/projects/${required('SUPABASE_PROJECT_REF')}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${required('SUPABASE_ACCESS_TOKEN')}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    external_email_enabled: true,
    mailer_autoconfirm: false,
    mailer_secure_email_change_enabled: true,
    smtp_admin_email: 'teavitused@send.poeruum.ee',
    smtp_host: 'smtp.resend.com',
    smtp_port: '465',
    smtp_user: 'resend',
    smtp_pass: required('RESEND_API_KEY'),
    smtp_sender_name: 'Poeruum',
    ...templates,
  }),
})

if (!response.ok) throw new Error(`Supabase Auth seadistamine ebaõnnestus (${response.status}): ${await response.text()}`)
console.log('Poeruumi Auth-kirjade SMTP ja mallid on uuendatud.')
