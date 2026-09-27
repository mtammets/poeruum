import { requireSupabase } from './supabase'

export type HomepageShowcaseStore = {
  id: string
  name: string
  slug: string
  isPublished: boolean
  eligibleProductCount: number
}
export type HomepageShowcaseSettings = { selectedStoreIds: string[]; stores: HomepageShowcaseStore[] }

export async function getHomepageStoreIds(): Promise<string[]> {
  const { data, error } = await requireSupabase().from('platform_settings')
    .select('homepage_store_ids').eq('id', 'homepage').single()
  if (error) throw error
  if (!Array.isArray(data?.homepage_store_ids)) throw new Error('Avalehe poodide valikut ei õnnestunud laadida.')
  return data.homepage_store_ids
}

export async function getHomepageShowcaseSettings(): Promise<HomepageShowcaseSettings> {
  const { data, error } = await requireSupabase().rpc('admin_homepage_showcase')
  if (error) throw new Error('Avalehe eelvaate seadeid ei õnnestunud laadida. Proovi uuesti.')
  return data as HomepageShowcaseSettings
}

export async function saveHomepageShowcaseSettings(selectedStoreIds: string[], expectedStoreIds: string[]): Promise<HomepageShowcaseSettings> {
  const { data, error } = await requireSupabase().rpc('admin_set_homepage_showcase', {
    selected_store_ids: selectedStoreIds, expected_store_ids: expectedStoreIds,
  })
  if (error) throw new Error(error.code === '40001'
    ? 'Valik on vahepeal muutunud. Laadi salvestatud valik ja proovi uuesti.'
    : error.code === '42501' ? 'Valiku muutmiseks on vaja administraatori õigusi.'
      : 'Valikut ei õnnestunud salvestada. Uuenda loendit ja proovi uuesti.')
  return data as HomepageShowcaseSettings
}

export function homepageStoreUnavailableReason(store: HomepageShowcaseStore): string | null {
  if (!store.isPublished) return 'Pood on avaldamata — eelvaates ei näidata.'
  if (!store.eligibleProductCount) return 'Puudub avalik laos olev toode, millel on pilt ja hind.'
  return null
}
