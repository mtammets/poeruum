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
  throw new Error('Kasutus: npm run supabase:order-email:preview -- nimi@example.com')
}

const html = `<!doctype html>
<html lang="et"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1efe9;color:#23221f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Kera Kodustuudio · sinu tellimus PR-N7K2A on kinnitatud.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1efe9">
    <tr><td align="center" style="padding:40px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px">
        <tr><td style="padding:0 4px 20px;font-size:21px;font-weight:800;letter-spacing:.08em;color:#171714">Kera Kodustuudio</td></tr>
        <tr><td style="overflow:hidden;border-radius:22px;background:#ffffff;box-shadow:0 10px 35px rgba(34,31,25,.08)">
          <div style="height:8px;background:#d9ff43"></div>
          <div style="padding:38px 38px 34px">
            <div style="margin-bottom:14px;color:#77736a;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Tellimus kinnitatud</div>
            <h1 style="margin:0 0 14px;color:#171714;font-size:30px;line-height:1.2;letter-spacing:-.03em">Aitäh tellimuse eest!</h1>
            <p style="margin:0 0 28px;color:#56534d;font-size:16px;line-height:1.65">Tere, Marek! Saime sinu tellimuse kätte ja makse õnnestus.</p>
            <div style="margin-bottom:22px;padding:18px 20px;border-radius:14px;background:#171714;color:#ffffff">
              <span style="display:block;color:#b8b5ad;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Tellimuse number</span>
              <strong style="display:block;margin-top:5px;font-size:21px">PR-N7K2A</strong>
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
              <tr><td style="padding:14px 0;border-bottom:1px solid #e8e6e1"><strong>Käsitööna valminud tass</strong><br><span style="color:#77736a;font-size:12px">Värv: Salveiroheline</span></td><td style="padding:14px 10px;border-bottom:1px solid #e8e6e1;text-align:center;color:#77736a">1 ×</td><td style="padding:14px 0;border-bottom:1px solid #e8e6e1;text-align:right;white-space:nowrap">24,00 €</td></tr>
              <tr><td style="padding:14px 0;border-bottom:1px solid #e8e6e1"><strong>Linane köögirätik</strong></td><td style="padding:14px 10px;border-bottom:1px solid #e8e6e1;text-align:center;color:#77736a">2 ×</td><td style="padding:14px 0;border-bottom:1px solid #e8e6e1;text-align:right;white-space:nowrap">28,00 €</td></tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;font-size:14px;color:#666159">
              <tr><td style="padding:5px 0">Tooted</td><td style="padding:5px 0;text-align:right">52,00 €</td></tr>
              <tr><td style="padding:5px 0">Tarne</td><td style="padding:5px 0;text-align:right">3,50 €</td></tr>
              <tr><td style="padding-top:14px;color:#171714;font-size:19px;font-weight:800">Kokku</td><td style="padding-top:14px;text-align:right;color:#171714;font-size:19px;font-weight:800">55,50 €</td></tr>
            </table>
            <div style="margin-top:26px;padding:18px 20px;border-radius:14px;background:#f6f4ef;color:#666159;font-size:14px;line-height:1.55"><strong style="color:#23221f">Tarne</strong><br>Omniva · Viru Keskuse pakiautomaat</div>
            <p style="margin:26px 0 0;color:#8a857d;font-size:12px;line-height:1.55">Hakkame tellimust ette valmistama. Küsimuste korral vasta sellele kirjale.</p>
          </div>
        </td></tr>
        <tr><td style="padding:22px 4px 0;color:#8a857d;font-size:12px;line-height:1.6">Kera Kodustuudio · tere@kerakodustuudio.ee<br>Pood töötab Poeruumil. See on kujunduse eelvaade — päris tellimust ei loodud.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${required('RESEND_API_KEY')}`,
    'Content-Type': 'application/json',
    'User-Agent': 'poeruum-order-preview/1.0',
  },
  body: JSON.stringify({
    from: 'Kera Kodustuudio via Poeruum <teavitused@send.poeruum.ee>',
    to: [recipient],
    subject: '[Eelvaade] Tellimus PR-N7K2A on kinnitatud · Kera Kodustuudio',
    html,
    tags: [{ name: 'email_type', value: 'preview_order_confirmation' }],
  }),
})

if (!response.ok) throw new Error(`Resend vastas ${response.status}: ${await response.text()}`)
console.log('Tellimuskinnituse eelvaade on saadetud.')
