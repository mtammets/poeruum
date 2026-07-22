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
  throw new Error('Kasutus: npm run supabase:auth-email:preview -- nimi@example.com')
}

const configResponse = await fetch(`https://api.supabase.com/v1/projects/${required('SUPABASE_PROJECT_REF')}/config/auth`, {
  headers: { Authorization: `Bearer ${required('SUPABASE_ACCESS_TOKEN')}` },
})
if (!configResponse.ok) throw new Error(`Auth-mallide laadimine ebaõnnestus (${configResponse.status}).`)
const authConfig = await configResponse.json()

const previews = [
  ['confirmation', 'Konto kinnitamine'],
  ['recovery', 'Parooli taastamine'],
  ['email_change', 'E-posti muutmine'],
  ['invite', 'Kutse'],
  ['magic_link', 'Sisselogimislink'],
]

const renderPreview = (html) => String(html)
  .replaceAll('{{ .ConfirmationURL }}', 'https://poeruum.ee')
  .replaceAll('{{ .SiteURL }}', 'https://poeruum.ee')
  .replaceAll('{{ .RedirectTo }}', 'https://poeruum.ee')
  .replaceAll('{{ .Email }}', recipient)
  .replaceAll('{{ .NewEmail }}', 'uus-aadress@example.com')
  .replaceAll('{{ .Token }}', '482193')

for (const [type, label] of previews) {
  const html = authConfig[`mailer_templates_${type}_content`]
  const subject = authConfig[`mailer_subjects_${type}`]
  if (!html || !subject) throw new Error(`Puudub ${type} mall või pealkiri.`)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${required('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      'User-Agent': 'poeruum-auth-preview/1.0',
    },
    body: JSON.stringify({
      from: 'Poeruum <teavitused@send.poeruum.ee>',
      to: [recipient],
      subject: `[Eelvaade] ${subject}`,
      html: renderPreview(html),
      tags: [{ name: 'email_type', value: `preview_${type}` }],
    }),
  })
  if (!response.ok) throw new Error(`${label}: Resend vastas ${response.status}: ${await response.text()}`)
  console.log(`${label}: saadetud`)
  await new Promise((resolve) => setTimeout(resolve, 250))
}
