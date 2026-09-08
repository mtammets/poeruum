import { requireSupabase } from './supabase'

export async function generateProductDescription(input: {
  storeId: string
  imageUrl: string
  name: string
  description: string
}, signal: AbortSignal): Promise<string> {
  const { data, error } = await requireSupabase().functions.invoke('product-description', { body: input, signal, timeout: 55_000 })
  if (error) {
    const context = 'context' in error ? error.context : null
    const details = context instanceof Response
      ? await context.clone().json().catch(() => null) as { error?: string } | null
      : null
    throw new Error(details?.error || 'Kirjelduse loomine ebaõnnestus. Palun proovi uuesti.')
  }
  if (typeof data?.description !== 'string' || !data.description.trim() || data.description.length > 1600) {
    throw new Error('Kirjeldust ei õnnestunud koostada. Proovi teist tootepilti.')
  }
  return data.description.trim()
}
