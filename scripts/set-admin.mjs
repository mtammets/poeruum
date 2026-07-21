import process from 'node:process'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

config({ path: '.env', quiet: true })

const email = process.argv[2]?.trim().toLowerCase()
const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim()
const adminKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!email) {
  console.error('Kasutus: npm run supabase:set-admin -- nimi@example.com')
  process.exit(1)
}
if (!supabaseUrl || !adminKey) {
  console.error('Puudub VITE_SUPABASE_URL või SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const admin = createClient(supabaseUrl, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
})
let page = 1
let user

while (!user) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) throw error
  user = data.users.find((candidate) => candidate.email?.toLowerCase() === email)
  if (user || data.users.length < 1000) break
  page += 1
}

if (!user) {
  console.error(`Kasutajat ${email} ei leitud.`)
  process.exit(1)
}

const { error } = await admin.auth.admin.updateUserById(user.id, {
  app_metadata: { ...user.app_metadata, role: 'admin' },
})
if (error) throw error

console.log(`${email} on nüüd Poeruumi administraator. Logi kontoga uuesti sisse, et uus roll rakenduks.`)
