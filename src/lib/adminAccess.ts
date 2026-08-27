import type { User } from '@supabase/supabase-js'

export const hasAdminRole = (user: Pick<User, 'app_metadata'>) => user.app_metadata?.role === 'admin'
