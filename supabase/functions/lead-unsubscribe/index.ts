import { createClient } from 'npm:@supabase/supabase-js@2'
import { captureEdgeError } from '../_shared/security.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
  try {
    const url = new URL(request.url)
    const token = url.searchParams.get('token')?.trim() ?? ''
    if (!uuidPattern.test(token)) return json({ error: 'Vigane loobumislink.' }, 400)

    if (request.method === 'GET') {
      const appUrl = (Deno.env.get('APP_URL')?.trim() || 'https://poeruum.ee').replace(/\/$/, '')
      return Response.redirect(`${appUrl}/loobu?token=${encodeURIComponent(token)}`, 302)
    }

    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await admin.rpc('unsubscribe_sales_outreach', { target_token: token })
    if (error) throw error
    return json({ ok: data === true })
  } catch (error) {
    await captureEdgeError('lead-unsubscribe', error)
    console.error(error)
    return json({ error: 'Kirjadest loobumine ebaõnnestus.' }, 500)
  }
})
