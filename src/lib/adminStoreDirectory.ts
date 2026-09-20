import { normalizeStoreDirectoryCatalog } from '../../shared/store-directory.mjs'
import { requireSupabase } from './supabase'

export class StoreDirectoryConflictError extends Error {
  constructor() {
    super('Poodide loend või järjekord on vahepeal muutunud. Laadi salvestatud järjekord ja proovi uuesti.')
  }
}

export async function saveStoreDirectoryOrder(storeIds: string[], expectedStoreIds: string[]) {
  const { data, error } = await requireSupabase().rpc('admin_set_store_directory_order', {
    ordered_store_ids: storeIds,
    expected_store_ids: expectedStoreIds,
  })
  if (error?.code === '40001') throw new StoreDirectoryConflictError()
  if (error) throw new Error(error.code === '42501'
    ? 'Järjekorra muutmiseks on vaja administraatori õigusi.'
    : 'Järjekorda ei õnnestunud salvestada. Proovi uuesti.')
  return normalizeStoreDirectoryCatalog(data)
}
