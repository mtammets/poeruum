import { config } from 'dotenv'
config({ path: '.env', quiet: true })

const action = process.argv[2] ?? 'verify'
if (!['apply', 'verify'].includes(action)) throw new Error('Usage: node scripts/configure-signup-observation.mjs [apply|verify]')
const ref = process.env.SUPABASE_PROJECT_REF
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!ref || !token) throw new Error('Supabase project and access token are required')
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const base = `https://api.supabase.com/v1/projects/${ref}`
const uri = 'pg-functions://postgres/public/observe_signup'
const readConfig = async () => {
  const response = await fetch(`${base}/config/auth`, { headers })
  if (!response.ok) throw new Error(`Auth config: HTTP ${response.status}`)
  return await response.json()
}
const before = await readConfig()
if (action === 'apply') {
  if (before.hook_before_user_created_enabled && before.hook_before_user_created_uri !== uri) {
    throw new Error('A different signup hook is enabled; integrate it before applying this configuration.')
  }
  const response = await fetch(`${base}/database/query`, { method: 'POST', headers, body: JSON.stringify({
    query: "select has_function_privilege('supabase_auth_admin','public.observe_signup(jsonb)','execute') as ready",
    read_only: true,
  }) })
  if (!response.ok || !(await response.json())[0]?.ready) throw new Error('Deploy the account hygiene migrations first')
  const update = await fetch(`${base}/config/auth`, { method: 'PATCH', headers, body: JSON.stringify({
    hook_before_user_created_enabled: true, hook_before_user_created_uri: uri,
  }) })
  if (!update.ok) throw new Error(`Hook configuration: HTTP ${update.status}`)
}
const result = await readConfig()
if (!result.hook_before_user_created_enabled || result.hook_before_user_created_uri !== uri) {
  throw new Error('Signup observation is not active')
}
console.log('Signup observation is active. CAPTCHA, email confirmation and other Auth settings are unchanged.')
