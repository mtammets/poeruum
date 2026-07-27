import { createClient } from 'npm:@supabase/supabase-js@2'
import { captureEdgeError } from '../_shared/security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ error: 'Sisselogimine on nõutud.' }, 401)

    const userClient = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('POERUUM_SUPABASE_PUBLISHABLE_KEY'),
      {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    )
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) return json({ error: 'Sisselogimine on aegunud.' }, 401)
    if (userData.user.app_metadata?.role !== 'admin') return json({ error: 'Administraatori ligipääs on nõutud.' }, 403)

    const body = await request.json()
    const { data, error } = await userClient.rpc('admin_set_homepage_seo', {
      next_seo_title: body.seoTitle,
      next_seo_description: body.seoDescription,
      next_social_title: body.socialTitle,
      next_social_description: body.socialDescription,
      next_search_indexing_enabled: body.searchIndexingEnabled,
    })
    if (error) throw error

    let deployId: string | null = null
    let deployWarning: string | null = null
    try {
      const deployResponse = await fetch(
        `https://api.render.com/v1/services/${encodeURIComponent(requiredEnv('RENDER_SERVICE_ID'))}/deploys`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${requiredEnv('RENDER_API_KEY')}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ clearCache: 'do_not_clear' }),
        },
      )
      const deploy = await deployResponse.json().catch(() => null) as { id?: string; message?: string } | null
      if (!deployResponse.ok) throw new Error(deploy?.message || `Render vastas ${deployResponse.status}.`)
      deployId = deploy?.id ?? null
    } catch (deployError) {
      deployWarning = deployError instanceof Error ? deployError.message : 'Tootmisdeploy ei käivitunud.'
      await captureEdgeError('admin-homepage-seo-deploy', deployError, { userId: userData.user.id }, 'warning')
    }

    return json({
      settings: data,
      deploy: deployWarning
        ? { status: 'failed', warning: deployWarning }
        : { status: 'queued', id: deployId },
    }, deployWarning ? 202 : 200)
  } catch (error) {
    await captureEdgeError('admin-homepage-seo', error)
    return json({
      error: 'SEO seadistuste salvestamine ebaõnnestus. Palun proovi uuesti.',
    }, 400)
  }
})
