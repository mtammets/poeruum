import process from 'node:process'
import WebSocket from 'ws'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env', quiet: true })
const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}
const options = { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } }
const admin = createClient(required('VITE_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), options)
const client = createClient(required('VITE_SUPABASE_URL'), required('VITE_SUPABASE_PUBLISHABLE_KEY'), options)
const suffix = crypto.randomUUID()
const email = `support-test-${suffix}@example.com`
const password = `Test-${suffix}!`
let userId = null

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createError || !created.user) throw createError || new Error('Testkasutajat ei loodud.')
  userId = created.user.id
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  const { data, error: invokeError } = await client.functions.invoke('support-actions', { body: {
    action: 'create',
    category: 'technical',
    subject: 'Tehniline kontroll — palun ignoreeri',
    body: 'See on Poeruumi klienditoe automaatne terviktest. Testkonto eemaldatakse kohe pärast kontrolli.',
    page_url: 'https://poeruum.ee/test',
    user_agent: 'Poeruum support test',
  } })
  if (invokeError || data?.error || !data?.id) throw new Error(data?.error || invokeError?.message || 'Vestlust ei loodud.')
  const { data: conversation, error: conversationError } = await admin.from('support_conversations').select('id,status').eq('id', data.id).single()
  const { count, error: messageError } = await admin.from('support_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', data.id)
  if (conversationError || messageError || !conversation || count !== 1) throw conversationError || messageError || new Error('Vestluse andmed ei ole terviklikud.')
  console.log('Klienditoe päring, andmebaas ja teavituskiri töötavad.')
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId)
}
