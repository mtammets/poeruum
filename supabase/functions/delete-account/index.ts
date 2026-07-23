import { createClient } from 'npm:@supabase/supabase-js@2'
import { deleteRenderCustomDomain } from '../_shared/render-custom-domain.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

type StorageEntry = { id: string | null; name: string }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sisselogimine on nõutud.' }, 401)

    const body = await request.json().catch(() => ({}))
    if (body.confirmation !== 'KUSTUTA') return json({ error: 'Kinnitus puudub.' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !publicKey || !serviceRoleKey) throw new Error('Funktsiooni keskkonnamuutujad puuduvad.')

    const userClient = createClient(supabaseUrl, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: stores, error: storesError } = await admin.from('stores').select('id').eq('owner_id', user.id)
    if (storesError) throw storesError

    const storeIds = (stores ?? []).map((store) => store.id)
    if (storeIds.length) {
      const { data: customDomains, error: domainsError } = await admin.from('custom_domains')
        .select('hostname,provider_domain_id,provider_redirect_domain_id')
        .in('store_id', storeIds)
      if (domainsError) throw domainsError
      for (const domain of customDomains ?? []) {
        await deleteRenderCustomDomain(domain.provider_domain_id || domain.hostname)
        if (domain.provider_redirect_domain_id && domain.provider_redirect_domain_id !== domain.provider_domain_id) {
          await deleteRenderCustomDomain(domain.provider_redirect_domain_id)
        }
      }
    }

    const listFiles = async (prefix: string): Promise<string[]> => {
      const paths: string[] = []
      let offset = 0
      while (true) {
        const { data, error } = await admin.storage.from('product-images').list(prefix, { limit: 100, offset })
        if (error) throw error
        const entries = (data ?? []) as StorageEntry[]
        for (const entry of entries) {
          const path = `${prefix}/${entry.name}`
          if (entry.id) paths.push(path)
          else paths.push(...await listFiles(path))
        }
        if (entries.length < 100) break
        offset += entries.length
      }
      return paths
    }

    for (const store of stores ?? []) {
      const paths = await listFiles(store.id)
      for (let index = 0; index < paths.length; index += 100) {
        const { error } = await admin.storage.from('product-images').remove(paths.slice(index, index + 100))
        if (error) throw error
      }
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
    if (deleteError) throw deleteError
    return json({ success: true })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Konto kustutamine ebaõnnestus.' }, 500)
  }
})
