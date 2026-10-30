import { companyCopyEqual, normalizeCompanyCopy, type CompanyCopy } from '../../shared/company-homepage-copy.mjs'
import { requireActiveSession } from './authSession'
import { requireSupabase } from './supabase'

export async function getCompanyHomepageOwner(storeId: string) {
  const client = requireSupabase()
  const { data: auth } = await client.auth.getSession()
  if (!auth.session) return null
  const { data, error } = await client.from('stores').select('id,owner_id')
    .eq('id', storeId).eq('owner_id', auth.session.user.id).maybeSingle()
  if (error) throw new Error('Muutmisõiguse kontroll ebaõnnestus. Proovi leht uuesti laadida.')
  return data?.owner_id === auth.session.user.id ? auth.session.user.id : null
}

export async function saveCompanyHomepageCopy(storeId: string, ownerId: string, copy: CompanyCopy, expected: CompanyCopy) {
  const client = requireSupabase()
  await requireActiveSession(client, ownerId)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Read private settings with the owner's session; public settings omit keys.
    const { data: store, error } = await client.from('stores').select('settings,updated_at')
      .eq('id', storeId).eq('owner_id', ownerId).maybeSingle()
    if (error) throw new Error('Tekstide laadimine ebaõnnestus. Proovi uuesti.')
    if (!store) throw new Error('Kodulehe muutmiseks logi sisse selle poe omanikuna.')
    if (!companyCopyEqual(store.settings.companyHomepage, expected)) {
      throw new Error('Tekste on vahepeal teises aknas muudetud. Kopeeri oma muudatused ja laadi leht uuesti.')
    }
    const next = normalizeCompanyCopy(copy)
    const { data: saved, error: saveError } = await client.from('stores')
      .update({ settings: { ...store.settings, companyHomepage: next } })
      .eq('id', storeId).eq('owner_id', ownerId).eq('updated_at', store.updated_at)
      .select('id').maybeSingle()
    if (saveError) throw new Error('Salvestamine ebaõnnestus. Sinu muudatused on alles; proovi uuesti.')
    if (saved) return next
  }
  throw new Error('Poe seaded muutusid salvestamise ajal. Proovi uuesti.')
}
