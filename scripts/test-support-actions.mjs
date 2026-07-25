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
const adminKey = process.env.SUPABASE_SECRET_KEY?.trim() || required('SUPABASE_SERVICE_ROLE_KEY')
const admin = createClient(required('VITE_SUPABASE_URL'), adminKey, options)
// Bypass public CAPTCHA only inside this trusted server-side health check.
const userClient = createClient(required('VITE_SUPABASE_URL'), adminKey, options)
const staffClient = createClient(required('VITE_SUPABASE_URL'), adminKey, options)
const suffix = crypto.randomUUID()
const email = `support-test-${suffix}@example.com`
const staffEmail = `support-admin-test-${suffix}@example.com`
const password = `Test-${suffix}!`
let userId = null
let staffUserId = null
let externalConversationId = null

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createError || !created.user) throw createError || new Error('Testkasutajat ei loodud.')
  userId = created.user.id
  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  const { data, error: invokeError } = await userClient.functions.invoke('support-actions', { body: {
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

  const { data: createdStaff, error: createStaffError } = await admin.auth.admin.createUser({
    email: staffEmail,
    password,
    email_confirm: true,
    app_metadata: { role: 'admin' },
  })
  if (createStaffError || !createdStaff.user) throw createStaffError || new Error('Testadministraatorit ei loodud.')
  staffUserId = createdStaff.user.id

  const { data: externalConversation, error: externalConversationError } = await admin.from('support_conversations').insert({
    user_id: null,
    store_id: null,
    subject: 'Välise tugikirja tehniline kontroll',
    category: 'technical',
    origin: 'email',
    external_email: 'delivered@resend.dev',
    external_name: 'Resendi testsaaja',
    page_url: 'mailto:info@poeruum.ee',
    user_agent: 'Poeruum support test',
  }).select('id').single()
  if (externalConversationError || !externalConversation) {
    throw externalConversationError || new Error('Välist testvestlust ei loodud.')
  }
  externalConversationId = externalConversation.id
  const { error: inboundMessageError } = await admin.from('support_messages').insert({
    conversation_id: externalConversation.id,
    sender_kind: 'user',
    sender_user_id: null,
    body: 'See on välise e-kirja vastuseharu automaatne terviktest.',
    source: 'email',
    inbound_message_id: `support-test-${suffix}`,
  })
  if (inboundMessageError) throw inboundMessageError

  const { error: staffSignInError } = await staffClient.auth.signInWithPassword({ email: staffEmail, password })
  if (staffSignInError) throw staffSignInError
  const { data: reply, error: replyError } = await staffClient.functions.invoke('support-actions', { body: {
    action: 'admin_reply',
    conversation_id: externalConversation.id,
    body: 'Poeruumi välise tugikirja vastuseharu automaatne testvastus.',
  } })
  if (replyError || reply?.error || !reply?.id) throw new Error(reply?.error || replyError?.message || 'Välisele kirjale ei vastatud.')

  const { data: replyMessage, error: replyMessageError } = await admin.from('support_messages')
    .select('sender_kind,resend_email_id,delivery_status')
    .eq('id', reply.id)
    .single()
  if (
    replyMessageError
    || replyMessage?.sender_kind !== 'admin'
    || !replyMessage.resend_email_id
    || replyMessage.delivery_status !== 'sent'
  ) throw replyMessageError || new Error('Välise kirja vastuse saatmisandmed ei ole terviklikud.')

  console.log('Klienditoe rakenduse päring, välise kirja vastus, andmebaas ja teavitused töötavad.')
} finally {
  if (externalConversationId) await admin.from('support_conversations').delete().eq('id', externalConversationId)
  if (staffUserId) await admin.auth.admin.deleteUser(staffUserId)
  if (userId) await admin.auth.admin.deleteUser(userId)
}
