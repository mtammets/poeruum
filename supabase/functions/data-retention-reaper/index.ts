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
type StorageEntry = { id: string | null; name: string }
type StorageCleanup = { id: string; resource_id: string }

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (request.headers.get('Authorization') !== `Bearer ${requiredEnv('ONBOARDING_CRON_SECRET')}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  try {
    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const listFiles = async (bucket: string, prefix: string): Promise<string[]> => {
      const paths: string[] = []
      let offset = 0
      while (true) {
        const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset })
        if (error) throw error
        const entries = (data ?? []) as StorageEntry[]
        for (const entry of entries) {
          const path = `${prefix}/${entry.name}`
          if (entry.id) paths.push(path)
          else paths.push(...await listFiles(bucket, path))
        }
        if (entries.length < 100) break
        offset += entries.length
      }
      return paths
    }
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

    const { data: storageCleanupRows, error: storageQueueError } = await admin
      .from('external_resource_cleanup')
      .select('id,resource_id')
      .eq('provider', 'supabase_storage')
      .eq('resource_type', 'product_image_prefix')
      .eq('status', 'pending')
      .order('created_at')
      .limit(100)
    if (storageQueueError) throw storageQueueError

    let cleanedDraftImagePrefixes = 0
    let failedDraftImagePrefixes = 0
    for (const cleanup of (storageCleanupRows ?? []) as StorageCleanup[]) {
      try {
        const paths = await listFiles('product-images', cleanup.resource_id)
        for (let index = 0; index < paths.length; index += 100) {
          const { error: storageError } = await admin.storage.from('product-images').remove(paths.slice(index, index + 100))
          if (storageError) throw storageError
        }
        const { error: completeError } = await admin.from('external_resource_cleanup').update({
          status: 'completed',
          last_error: null,
          completed_at: new Date().toISOString(),
        }).eq('id', cleanup.id)
        if (completeError) throw completeError
        cleanedDraftImagePrefixes += 1
      } catch (cleanupError) {
        failedDraftImagePrefixes += 1
        const message = cleanupError instanceof Error ? cleanupError.message : 'Mustandi failide kustutamine ebaõnnestus.'
        await admin.from('external_resource_cleanup').update({
          last_error: message.slice(0, 500),
        }).eq('id', cleanup.id)
        await captureEdgeError('data-retention-draft-storage', cleanupError, { cleanup_id: cleanup.id }, 'warning')
      }
    }

    return json({
      support_conversations: deletedSupportConversations,
      support_attachments: deletedSupportAttachments,
      draft_image_prefixes: cleanedDraftImagePrefixes,
      failed_draft_image_prefixes: failedDraftImagePrefixes,
      ...((retained ?? {}) as Record<string, unknown>),
    })
  } catch (error) {
    await captureEdgeError('data-retention-reaper', error, {}, 'critical')
    console.error(error)
    return json({ error: 'Säilitustähtaja töö ebaõnnestus.' }, 500)
  }
})
