import process from 'node:process'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const siteKey = process.env.VITE_TURNSTILE_SITE_KEY?.trim()
const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim()
if (Boolean(siteKey) !== Boolean(secretKey)) {
  throw new Error('Turnstile’i site key ja secret key peavad olema seadistatud koos.')
}

const body = {
  password_min_length: 12,
  password_required_characters: "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~",
  password_hibp_enabled: true,
  rate_limit_anonymous_users: 10,
  rate_limit_email_sent: 10,
  rate_limit_sms_sent: 10,
  rate_limit_verify: 30,
  rate_limit_token_refresh: 150,
  rate_limit_otp: 10,
  rate_limit_web3: 10,
  smtp_max_frequency: 60,
  ...(siteKey && secretKey ? {
    security_captcha_enabled: true,
    security_captcha_provider: 'turnstile',
    security_captcha_secret: secretKey,
  } : {}),
}

const response = await fetch(`https://api.supabase.com/v1/projects/${required('SUPABASE_PROJECT_REF')}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${required('SUPABASE_ACCESS_TOKEN')}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
})

if (!response.ok) throw new Error(`Supabase Auth turvaseadistus ebaõnnestus (${response.status}): ${await response.text()}`)
console.log(siteKey
  ? 'Supabase Auth paroolipoliitika ja Turnstile on uuendatud.'
  : 'Supabase Auth paroolipoliitika on uuendatud; Turnstile ootab võtmeid.')
