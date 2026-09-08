import { createClient } from 'npm:@supabase/supabase-js@2'
import { generateProductDescription, parseProductDescriptionInput } from '../_shared/product-description.ts'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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
    const supabaseUrl = requiredEnv('SUPABASE_URL')
    const client = createClient(supabaseUrl, requiredEnv('POERUUM_SUPABASE_PUBLISHABLE_KEY'), {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: authError } = await client.auth.getUser()
    if (authError || !user) return json({ error: 'Sessioon on aegunud. Logi uuesti sisse.' }, 401)
    if (Number(request.headers.get('content-length')) > 20_000) return json({ error: 'Toote andmed on liiga mahukad.' }, 413)
    const input = parseProductDescriptionInput(await request.json().catch(() => null), supabaseUrl)
    if (!input) return json({ error: 'Kontrolli toote andmeid ja oota, kuni tootepilt on üles laaditud.' }, 400)
    const { data: store, error: storeError } = await client.from('stores').select('id,owner_id').eq('id', input.storeId).maybeSingle()
    if (storeError) throw storeError
    if (!store || (store.owner_id !== user.id && user.app_metadata?.role !== 'admin')) {
      return json({ error: 'Sul puudub selle poe muutmise õigus.' }, 403)
    }
    const apiKey = requiredEnv('OPENAI_API_KEY')
    const burst = await checkRateLimit(request, 'product-description', 10, 600, user.id)
    if (!burst.allowed) return rateLimitResponse(burst.retry_after_seconds, corsHeaders)
    const daily = await checkRateLimit(request, 'product-description-daily', 100, 86400, user.id)
    if (!daily.allowed) return rateLimitResponse(daily.retry_after_seconds, corsHeaders)
    const description = await generateProductDescription(apiKey, input, Deno.env.get('OPENAI_PRODUCT_DESCRIPTION_MODEL')?.trim() || undefined)
    return json({ description })
  } catch (error) {
    await captureEdgeError('product-description', error)
    return json({ error: 'Kirjelduse loomine ebaõnnestus. Palun proovi uuesti.' }, 500)
  }
})
