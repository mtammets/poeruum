import { createClient } from '@supabase/supabase-js'
import { createSharedAuthStorage } from './sharedAuthStorage'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

const authStorage = typeof window === 'undefined' ? undefined : createSharedAuthStorage(window.location, document, {
  getItem: (key) => window.localStorage.getItem(key),
  removeItem: (key) => window.localStorage.removeItem(key),
})

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: authStorage,
      },
    })
  : null

export const requireSupabase = () => {
  if (!supabase) throw new Error('Supabase ei ole seadistatud. Lisa VITE_SUPABASE_URL ja VITE_SUPABASE_PUBLISHABLE_KEY .env faili.')
  return supabase
}
