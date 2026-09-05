import { requireSupabase } from '../lib/supabase'
import { MAX_CARD_BYTES, parseCardDocument, type CardDocument } from './model'

export const MAX_CARD_DRAFT_BYTES = MAX_CARD_BYTES

export interface CloudCardDraft {
  document: CardDocument
  revision: number
  updatedAt: string
}

export interface LocalCardDraft {
  document: CardDocument
  baseRevision: number | null
  updatedAt: string
  dirty: boolean
}

export class CardDraftConflictError extends Error {
  constructor() {
    super('Kaarti on teises aknas muudetud. Laadi salvestatud versioon enne uuesti salvestamist.')
    this.name = 'CardDraftConflictError'
  }
}

function validateRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function validateTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validateDocument(value: unknown): CardDocument {
  const document = parseCardDocument(value)
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > MAX_CARD_DRAFT_BYTES) {
    throw new Error('Kujundus on liiga suur. Vähenda piltide mahtu (kuni 12 MB kokku).')
  }
  return document
}

function parseCloudDraft(value: unknown): CloudCardDraft {
  if (!value || typeof value !== 'object') throw new Error('Salvestatud kaardi andmed ei ole loetavad.')
  const row = value as Record<string, unknown>
  if (!validateRevision(row.revision) || !validateTimestamp(row.updated_at)) {
    throw new Error('Salvestatud kaardi versioon ei ole loetav.')
  }
  return { document: validateDocument(row.document), revision: row.revision, updatedAt: row.updated_at }
}

function parseLocalDraft(value: unknown): LocalCardDraft {
  if (!value || typeof value !== 'object') throw new Error('Brauseri mustand ei ole loetav.')
  const draft = value as Record<string, unknown>
  if (!(draft.baseRevision === null || validateRevision(draft.baseRevision))
    || !validateTimestamp(draft.updatedAt) || typeof draft.dirty !== 'boolean') {
    throw new Error('Brauseri mustandi versioon ei ole loetav.')
  }
  return {
    document: validateDocument(draft.document),
    baseRevision: draft.baseRevision,
    updatedAt: draft.updatedAt,
    dirty: draft.dirty,
  }
}

/** A failed read throws: callers must never interpret failure as an empty cloud draft. */
export async function loadCloudCardDraft(userId: string): Promise<CloudCardDraft | null> {
  const { data, error } = await requireSupabase()
    .from('admin_business_card_drafts')
    .select('document,revision,updated_at')
    .eq('user_id', userId)
    .abortSignal(AbortSignal.timeout(5000))
    .retry(false)
    .maybeSingle()
  if (error) throw new Error('Salvestatud kaarti ei õnnestunud laadida. Brauseri mustand on alles.')
  return data === null ? null : parseCloudDraft(data)
}

/** null creates only; an existing draft requires the exact last loaded revision. */
export async function saveCloudCardDraft(document: CardDocument, expectedRevision: number | null): Promise<CloudCardDraft> {
  if (expectedRevision !== null && !validateRevision(expectedRevision)) {
    throw new Error('Kaardi salvestatud versioon puudub. Laadi kaart uuesti.')
  }
  const validated = validateDocument(document)
  const { data, error } = await requireSupabase().rpc('admin_save_business_card', {
    next_document: validated,
    expected_revision: expectedRevision,
  })
  if (error?.code === '40001') throw new CardDraftConflictError()
  if (error) throw new Error('Pilve salvestamine ebaõnnestus. Proovi uuesti.')
  // PostgREST can represent a composite-returning RPC as one row or a row array.
  const saved = parseCloudDraft(Array.isArray(data) && data.length === 1 ? data[0] : data)
  if (saved.revision !== (expectedRevision ?? 0) + 1) {
    throw new Error('Salvestamist ei õnnestunud kinnitada. Laadi kaart uuesti.')
  }
  return saved
}

const DATABASE_NAME = 'poeruum-business-card-drafts'
const STORE_NAME = 'drafts'

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Brauseri mustandite salvestus ei ole saadaval.'))
      return
    }
    const request = indexedDB.open(DATABASE_NAME, 1)
    let settled = false
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => {
      settled = true
      reject(new Error('Brauseri mustandite salvestust ei õnnestunud avada.'))
    }
    request.onblocked = () => {
      settled = true
      reject(new Error('Sulge teised Poeruumi aknad ja proovi uuesti.'))
    }
  })
}

async function withDraftStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDraftDatabase()
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction
    let request: IDBRequest<T>
    try {
      transaction = database.transaction(STORE_NAME, mode)
      request = action(transaction.objectStore(STORE_NAME))
    } catch {
      database.close()
      reject(new Error('Brauseri mustandi salvestus ebaõnnestus.'))
      return
    }
    // An individual request can succeed before its transaction fails (e.g. quota).
    // Only acknowledge the draft once the entire transaction has committed.
    transaction.oncomplete = () => { database.close(); resolve(request.result) }
    transaction.onabort = () => {
      database.close()
      reject(new Error('Brauseri mustandit ei saanud salvestada. Kontrolli vaba salvestusruumi.'))
    }
    transaction.onerror = () => { /* The following abort event handles the rejection. */ }
  })
}

export async function loadLocalCardDraft(userId: string): Promise<LocalCardDraft | null> {
  const value = await withDraftStore<unknown>('readonly', (store) => store.get(userId))
  return value === undefined ? null : parseLocalDraft(value)
}

export async function saveLocalCardDraft(userId: string, draft: LocalCardDraft): Promise<void> {
  const validated = parseLocalDraft(draft)
  await withDraftStore('readwrite', (store) => store.put(validated, userId))
}

export async function removeLocalCardDraft(userId: string): Promise<void> {
  await withDraftStore('readwrite', (store) => store.delete(userId))
}
