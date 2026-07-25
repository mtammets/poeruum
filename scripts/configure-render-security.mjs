import process from 'node:process'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://checkout.stripe.com",
  "script-src 'self' https://challenges.cloudflare.com https://connect-js.stripe.com https://js.stripe.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com 'sha256-0hAheEzaMe6uXIKV4EehS9pu1am1lj/KnnzrOYqckXk='",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  [
    "connect-src 'self'",
    'https://foctericixquaogwboqg.supabase.co',
    'wss://foctericixquaogwboqg.supabase.co',
    'https://challenges.cloudflare.com',
    'https://connect-js.stripe.com',
    'https://api.stripe.com',
    'https://*.stripe.com',
    'https://ariregister.rik.ee',
    'https://aks.geoportaal.ee',
    'https://www.omniva.ee',
  ].join(' '),
  'frame-src https://challenges.cloudflare.com https://connect-js.stripe.com https://js.stripe.com https://*.stripe.com',
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ')

export const SECURITY_HEADERS = [
  { path: '/*', name: 'Content-Security-Policy', value: CSP },
  { path: '/*', name: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { path: '/*', name: 'X-Frame-Options', value: 'DENY' },
  { path: '/*', name: 'X-Content-Type-Options', value: 'nosniff' },
  { path: '/*', name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { path: '/*', name: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const normalize = (headers) => headers
  .map((item) => item.header ?? item)
  .map(({ path, name, value }) => ({ path, name, value }))
  .sort((left, right) => left.name.localeCompare(right.name))

const expected = JSON.stringify(normalize(SECURITY_HEADERS))
const action = process.argv[2] ?? 'verify'
if (!['apply', 'verify'].includes(action)) {
  throw new Error('Kasuta käsku kujul: node scripts/configure-render-security.mjs [apply|verify]')
}

const endpoint = `https://api.render.com/v1/services/${required('RENDER_SERVICE_ID')}/headers`
const request = async (method, body) => {
  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${required('RENDER_API_KEY')}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) {
    throw new Error(`Renderi turvapäiste päring ebaõnnestus (${response.status}): ${await response.text()}`)
  }
  return response.json()
}

if (action === 'apply') {
  await request('PUT', SECURITY_HEADERS)
}

const actual = await request('GET')
if (JSON.stringify(normalize(actual)) !== expected) {
  throw new Error('Renderi turvapäised ei vasta hoidlas määratud seadistusele.')
}

console.log(action === 'apply'
  ? 'Renderi turvapäised rakendati ja kontrolliti.'
  : 'Renderi turvapäised vastavad hoidla seadistusele.')
