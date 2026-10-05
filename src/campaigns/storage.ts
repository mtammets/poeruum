import { requireSupabase } from '../lib/supabase'
import { createRandomId } from '../lib/randomId'
import { validateCampaign, type CampaignDocument } from './model'

export type CampaignVersion = { id: string; campaign_id: string; name: string; template: string; created_at: string; local?: boolean }
type LocalEntry = { key: string; userId: string; document: CampaignDocument; summary?: CampaignVersion }

async function localStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('poeruum-admin-campaigns', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('documents', { keyPath: 'key' }) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('documents', mode), request = run(tx.objectStore('documents'))
    tx.oncomplete = () => { db.close(); resolve(request.result) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Brauserisse salvestamine ebaõnnestus.')) }
  })
}
export async function loadLocalCampaign(userId: string) {
  const row = await localStore<LocalEntry | undefined>('readonly', (store) => store.get(`${userId}:draft`))
  // Keep an unfinished query or overlong action sequence editable after reload.
  // Export/version saving still use the strict document validator.
  return row ? validateCampaign(row.document, true) : null
}
export async function saveLocalCampaign(userId: string, document: CampaignDocument) {
  await localStore('readwrite', (store) => store.put({ key: `${userId}:draft`, userId, document }))
}
export async function listCampaignVersions(userId: string) {
  const [cloud, local] = await Promise.allSettled([
    requireSupabase().from('admin_campaign_versions').select('id,campaign_id,name,template,created_at').order('created_at', { ascending: false }).limit(30).then(({ data, error }) => { if (error) throw error; return (data ?? []) as CampaignVersion[] }),
    localStore<LocalEntry[]>('readonly', (store) => store.getAll()),
  ])
  const versions = new Map<string, CampaignVersion>()
  if (local.status === 'fulfilled') for (const row of local.value) if (row.userId === userId && row.summary) versions.set(row.summary.id, row.summary)
  if (cloud.status === 'fulfilled') for (const row of cloud.value) versions.set(row.id, row)
  return { versions: [...versions.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30), cloudAvailable: cloud.status === 'fulfilled' }
}
export async function saveCampaignVersion(userId: string, document: CampaignDocument) {
  if (!validateCampaign(document)) throw new Error('Kontrolli kampaania tekste ja pilte.')
  const summary: CampaignVersion = { id: createRandomId(), campaign_id: document.id, name: document.name, template: document.template, created_at: new Date().toISOString(), local: true }
  // Save the durable local snapshot before attempting the network.
  let localSaved = false
  try {
    await localStore('readwrite', (store) => store.put({ key: `${userId}:${summary.id}`, userId, document, summary }))
    localSaved = true
  } catch { /* A full or unavailable browser store must not prevent cloud saving. */ }
  try {
    const { data, error } = await requireSupabase().from('admin_campaign_versions').insert({ id: summary.id, campaign_id: document.id, name: document.name, template: document.template, document })
      .select('id,campaign_id,name,template,created_at').single()
    if (error) throw error
    return { ...data, local: false } as CampaignVersion
  } catch {
    if (localSaved) return summary
    throw new Error('Versiooni ei saanud brauserisse ega pilve salvestada.')
  }
}
export async function loadCampaignVersion(userId: string, version: CampaignVersion) {
  let doc: CampaignDocument | null = null
  if (!version.local) {
    const { data, error } = await requireSupabase().from('admin_campaign_versions').select('document').eq('id', version.id).single()
    if (!error) doc = validateCampaign(data?.document)
  }
  if (!doc) {
    const local = await localStore<LocalEntry | undefined>('readonly', (store) => store.get(`${userId}:${version.id}`))
    doc = validateCampaign(local?.document)
  }
  if (!doc) throw new Error('Versiooni ei saanud avada. Proovi uuesti.')
  return doc
}
