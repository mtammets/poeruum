import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const action = process.argv[2] ?? 'check'
const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_DB_PASSWORD',
]
const missing = required.filter((name) => !process.env[name]?.trim())
const hasAdminKey = Boolean(process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())

if (missing.length || !hasAdminKey) {
  if (missing.length) console.error(`Puuduvad väärtused: ${missing.join(', ')}`)
  if (!hasAdminKey) console.error('Puudub SUPABASE_SECRET_KEY või SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const expectedUrl = `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`
if (process.env.VITE_SUPABASE_URL.replace(/\/$/, '') !== expectedUrl) {
  console.error('VITE_SUPABASE_URL ja SUPABASE_PROJECT_REF ei viita samale projektile.')
  process.exit(1)
}

console.log('Kõik vajalikud Supabase’i keskkonnamuutujad on olemas.')
if (action === 'check') process.exit(0)

const executable = path.resolve('node_modules', '.bin', process.platform === 'win32' ? 'supabase.cmd' : 'supabase')
const run = (args) => {
  const result = spawnSync(executable, args, { env: process.env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['link', '--project-ref', process.env.SUPABASE_PROJECT_REF])

if (action === 'link') process.exit(0)
if (action === 'deploy') {
  run(['db', 'push', '--linked'])
  process.exit(0)
}
if (action === 'functions') {
  run(['functions', 'deploy', 'delete-account', '--project-ref', process.env.SUPABASE_PROJECT_REF])
  run(['functions', 'deploy', 'stripe-webhook', '--project-ref', process.env.SUPABASE_PROJECT_REF, '--no-verify-jwt'])
  run(['functions', 'deploy', 'stripe-connect-webhook', '--project-ref', process.env.SUPABASE_PROJECT_REF, '--no-verify-jwt'])
  run(['functions', 'deploy', 'stripe-connect', '--project-ref', process.env.SUPABASE_PROJECT_REF])
  process.exit(0)
}

console.error(`Tundmatu tegevus: ${action}`)
process.exit(1)
