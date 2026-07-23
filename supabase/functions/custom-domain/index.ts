import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  createRenderCustomDomains,
  deleteRenderCustomDomain,
  getRenderCustomDomain,
  getRenderServiceHostname,
  hasActiveTls,
  verifyRenderCustomDomain,
  type RenderCustomDomain,
} from '../_shared/render-custom-domain.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

type DomainAction = 'create' | 'status' | 'verify' | 'delete'
type DomainBody = { action?: DomainAction; storeId?: string; hostname?: string }
type DomainRow = {
  id: string
  store_id: string
  hostname: string
  redirect_hostname: string | null
  status: 'pending_dns' | 'verifying' | 'active' | 'error'
  provider_domain_id: string | null
  provider_redirect_domain_id: string | null
  provider_verification_status: 'verified' | 'unverified' | null
  domain_type: 'apex' | 'subdomain' | null
  public_suffix: string | null
  dns_record_type: string | null
  dns_record_name: string | null
  dns_record_value: string | null
  last_error: string | null
  dns_verified_at: string | null
  tls_verified_at: string | null
  last_checked_at: string | null
}

const normalizeHostname = (input: string) => {
  const raw = input.trim()
  if (!raw) throw new Error('Sisesta domeen, näiteks www.sinupood.ee.')
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw new Error('Sisesta kehtiv domeen, näiteks www.sinupood.ee.')
  }
  if (url.username || url.password || url.port) throw new Error('Sisesta ainult domeeninimi ilma kasutaja või pordita.')
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
    throw new Error('Sisesta kehtiv domeen, näiteks www.sinupood.ee.')
  }
  if (hostname === 'poeruum.ee' || hostname.endsWith('.poeruum.ee')) {
    throw new Error('Poeruumi aadress on sul juba olemas. Siia lisa enda domeen.')
  }
  return hostname
}

const dnsRecordFor = (domain: RenderCustomDomain) => {
  if (domain.domainType === 'apex') {
    return {
      type: 'A',
      name: '@',
      value: Deno.env.get('RENDER_APEX_IPV4')?.trim() || '216.24.57.1',
    }
  }

  const labels = domain.name.split('.')
  const suffixLabels = domain.publicSuffix.split('.').length
  const hostLabels = labels.slice(0, Math.max(1, labels.length - suffixLabels - 1))
  return {
    type: 'CNAME',
    name: hostLabels.join('.'),
    value: getRenderServiceHostname(),
  }
}

const publicDomain = (row: DomainRow | null) => row ? {
  id: row.id,
  storeId: row.store_id,
  hostname: row.hostname,
  status: row.status,
  verificationStatus: row.provider_verification_status,
  domainType: row.domain_type,
  dnsRecord: row.dns_record_type && row.dns_record_name && row.dns_record_value ? {
    type: row.dns_record_type,
    name: row.dns_record_name,
    value: row.dns_record_value,
  } : null,
  error: row.last_error,
  dnsVerifiedAt: row.dns_verified_at,
  tlsVerifiedAt: row.tls_verified_at,
  lastCheckedAt: row.last_checked_at,
} : null

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sisselogimine on nõutud.' }, 401)

    const supabaseUrl = requiredEnv('SUPABASE_URL')
    const publicKey = requiredEnv('POERUUM_SUPABASE_PUBLISHABLE_KEY')
    const serviceRoleKey = requiredEnv('POERUUM_SUPABASE_SECRET_KEY')
    const userClient = createClient(supabaseUrl, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)

    const body = await request.json().catch(() => ({})) as DomainBody
    const action = body.action
    const storeId = String(body.storeId ?? '')
    if (!action || !storeId) return json({ error: 'Domeenipäringu andmed on puudulikud.' }, 400)

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: store, error: storeError } = await admin.from('stores').select('id,owner_id').eq('id', storeId).maybeSingle()
    if (storeError) throw storeError
    if (!store || store.owner_id !== user.id) return json({ error: 'Poodi ei leitud või sul puudub selle muutmise õigus.' }, 404)

    const getRow = async () => {
      const { data, error } = await admin.from('custom_domains').select('*').eq('store_id', storeId).maybeSingle()
      if (error) throw error
      return data as DomainRow | null
    }

    if (action === 'create') {
      const hostname = normalizeHostname(String(body.hostname ?? ''))
      const existing = await getRow()
      if (existing && existing.hostname !== hostname) {
        return json({ error: 'Poel on juba domeen. Eemalda senine ühendus enne uue lisamist.' }, 409)
      }

      let row = existing
      if (!row) {
        const siblingHostname = hostname.startsWith('www.') ? hostname.slice(4) : `www.${hostname}`
        const { data: claimedDomain, error: claimError } = await admin.from('custom_domains')
          .select('store_id')
          .or(`hostname.in.(${hostname},${siblingHostname}),redirect_hostname.in.(${hostname},${siblingHostname})`)
          .neq('store_id', storeId)
          .limit(1)
          .maybeSingle()
        if (claimError) throw claimError
        if (claimedDomain) return json({ error: 'See domeen on juba teise Poeruumi poega seotud.' }, 409)

        const { data, error } = await admin.from('custom_domains').insert({
          store_id: storeId,
          hostname,
          status: 'pending_dns',
        }).select().single()
        if (error) {
          if (error.code === '23505') return json({ error: 'See domeen on juba teise Poeruumi poega seotud.' }, 409)
          throw error
        }
        row = data as DomainRow
      }

      try {
        let renderDomains: RenderCustomDomain[]
        try {
          renderDomains = await createRenderCustomDomains(hostname)
        } catch (error) {
          if ((error as Error & { status?: number }).status !== 409) throw error
          const existingDomain = await getRenderCustomDomain(hostname)
          const redirectDomain = existingDomain.redirectForName && existingDomain.redirectForName !== hostname
            ? await getRenderCustomDomain(existingDomain.redirectForName).catch(() => null)
            : null
          renderDomains = [existingDomain, ...(redirectDomain ? [redirectDomain] : [])]
        }
        const renderDomain = renderDomains.find((domain) => domain.name === hostname) ?? renderDomains[0]
        const redirectDomain = renderDomains.find((domain) => domain.id !== renderDomain.id) ?? null
        const record = dnsRecordFor(renderDomain)
        const now = new Date().toISOString()
        const isVerified = renderDomain.verificationStatus === 'verified'
        const tlsActive = isVerified && await hasActiveTls(hostname)
        const { data, error } = await admin.from('custom_domains').update({
          provider_domain_id: renderDomain.id,
          provider_redirect_domain_id: redirectDomain?.id ?? null,
          redirect_hostname: renderDomain.redirectForName && renderDomain.redirectForName !== hostname
            ? renderDomain.redirectForName
            : null,
          provider_verification_status: renderDomain.verificationStatus,
          domain_type: renderDomain.domainType,
          public_suffix: renderDomain.publicSuffix,
          dns_record_type: record.type,
          dns_record_name: record.name,
          dns_record_value: record.value,
          status: tlsActive ? 'active' : isVerified ? 'verifying' : 'pending_dns',
          dns_verified_at: isVerified ? now : null,
          tls_verified_at: tlsActive ? now : null,
          last_checked_at: now,
          last_error: null,
        }).eq('id', row.id).select().single()
        if (error) throw error
        return json({ domain: publicDomain(data as DomainRow) }, 201)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Domeeni lisamine Renderisse ebaõnnestus.'
        await admin.from('custom_domains').update({ status: 'error', last_error: message, last_checked_at: new Date().toISOString() }).eq('id', row.id)
        throw error
      }
    }

    const row = await getRow()
    if (!row) {
      if (action === 'status') return json({ domain: null })
      return json({ error: 'Sellel poel pole ühendatavat domeeni.' }, 404)
    }

    if (action === 'delete') {
      await deleteRenderCustomDomain(row.provider_domain_id || row.hostname)
      if (row.provider_redirect_domain_id && row.provider_redirect_domain_id !== row.provider_domain_id) {
        await deleteRenderCustomDomain(row.provider_redirect_domain_id)
      }
      const { error } = await admin.from('custom_domains').delete().eq('id', row.id)
      if (error) throw error
      return json({ domain: null })
    }

    if (action === 'verify') {
      await verifyRenderCustomDomain(row.provider_domain_id || row.hostname)
    }

    const renderDomain = await getRenderCustomDomain(row.provider_domain_id || row.hostname)
    const record = dnsRecordFor(renderDomain)
    const now = new Date().toISOString()
    const isVerified = renderDomain.verificationStatus === 'verified'
    const tlsActive = isVerified && await hasActiveTls(row.hostname)
    const nextStatus = tlsActive ? 'active' : isVerified ? 'verifying' : 'pending_dns'
    const { data, error } = await admin.from('custom_domains').update({
      provider_domain_id: renderDomain.id,
      redirect_hostname: renderDomain.redirectForName && renderDomain.redirectForName !== row.hostname
        ? renderDomain.redirectForName
        : null,
      provider_verification_status: renderDomain.verificationStatus,
      domain_type: renderDomain.domainType,
      public_suffix: renderDomain.publicSuffix,
      dns_record_type: record.type,
      dns_record_name: record.name,
      dns_record_value: record.value,
      status: nextStatus,
      dns_verified_at: isVerified ? row.dns_verified_at || now : null,
      tls_verified_at: tlsActive ? row.tls_verified_at || now : null,
      last_checked_at: now,
      last_error: null,
    }).eq('id', row.id).select().single()
    if (error) throw error
    return json({ domain: publicDomain(data as DomainRow) })
  } catch (error) {
    console.error('Kohandatud domeeni haldus ebaõnnestus.', error)
    return json({ error: error instanceof Error ? error.message : 'Domeeni haldus ebaõnnestus.' }, 500)
  }
})
