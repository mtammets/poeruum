import { createClient } from 'npm:@supabase/supabase-js@2'
import { captureEdgeError } from '../_shared/security.ts'

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

type ResolvedConversation = { id: string }
type SupportAttachment = { attachment_path: string | null }

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (request.headers.get('Authorization') !== `Bearer ${requiredEnv('ONBOARDING_CRON_SECRET')}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  try {
    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const supportCutoff = new Date()
    supportCutoff.setUTCMonth(supportCutoff.getUTCMonth() - 24)
    let deletedSupportConversations = 0
    let deletedSupportAttachments = 0

    // Keep each run bounded. A daily run can catch up by deleting up to 1,000
    // conversations while removing stored objects through the supported API.
    for (let batch = 0; batch < 10; batch += 1) {
      const { data, error } = await admin.from('support_conversations')
        .select('id')
        .eq('status', 'resolved')
        .lt('resolved_at', supportCutoff.toISOString())
        .order('resolved_at')
        .limit(100)
      if (error) throw error

      const conversations = (data ?? []) as ResolvedConversation[]
      if (!conversations.length) break
      const conversationIds = conversations.map(({ id }) => id)

      const { data: attachmentRows, error: attachmentError } = await admin.from('support_messages')
        .select('attachment_path')
        .in('conversation_id', conversationIds)
        .not('attachment_path', 'is', null)
      if (attachmentError) throw attachmentError

      const attachmentPaths = [...new Set(
        ((attachmentRows ?? []) as SupportAttachment[])
          .map(({ attachment_path }) => attachment_path)
          .filter((path): path is string => Boolean(path)),
      )]
      for (let index = 0; index < attachmentPaths.length; index += 100) {
        const paths = attachmentPaths.slice(index, index + 100)
        const { error: storageError } = await admin.storage.from('support-attachments').remove(paths)
        if (storageError) throw storageError
        deletedSupportAttachments += paths.length
      }

      const { error: deleteError, count } = await admin.from('support_conversations')
        .delete({ count: 'exact' })
        .in('id', conversationIds)
      if (deleteError) throw deleteError
      deletedSupportConversations += count ?? conversations.length
      if (conversations.length < 100) break
    }

    const { data: retained, error: retentionError } = await admin.rpc('apply_data_retention', {
      reference_time: new Date().toISOString(),
    })
    if (retentionError) throw retentionError

    return json({
      support_conversations: deletedSupportConversations,
      support_attachments: deletedSupportAttachments,
      ...((retained ?? {}) as Record<string, unknown>),
    })
  } catch (error) {
    await captureEdgeError('data-retention-reaper', error, {}, 'critical')
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Säilitustähtaja töö ebaõnnestus.' }, 500)
  }
})
