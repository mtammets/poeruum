const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value.replace(/\/$/, '')
}

const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { ...responseHeaders, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' },
    })
  }
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 })

  try {
    const supabaseUrl = requiredEnv('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim()
    if (!anonKey) throw new Error('Puudub SUPABASE_ANON_KEY.')

    const settingsResponse = await fetch(
      `${supabaseUrl}/rest/v1/platform_settings?select=social_image_path&id=eq.homepage`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }, cache: 'no-store' },
    )
    if (!settingsResponse.ok) throw new Error(`Avalehe seadistus vastas ${settingsResponse.status}.`)
    const settings = await settingsResponse.json()
    const path = typeof settings?.[0]?.social_image_path === 'string' ? settings[0].social_image_path : ''

    if (!path) {
      return new Response(null, { status: 404, headers: responseHeaders })
    }

    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    const assetResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/public/platform-assets/${encodedPath}`,
      { cache: 'no-store' },
    )
    if (!assetResponse.ok) throw new Error(`Jagamispilt vastas ${assetResponse.status}.`)

    return new Response(request.method === 'HEAD' ? null : assetResponse.body, {
      status: 200,
      headers: {
        ...responseHeaders,
        'Content-Type': assetResponse.headers.get('content-type') || 'image/webp',
        ...(assetResponse.headers.get('content-length')
          ? { 'Content-Length': assetResponse.headers.get('content-length')! }
          : {}),
      },
    })
  } catch (error) {
    console.error('Avalehe jagamispildi laadimine ebaõnnestus.', error)
    return new Response(null, { status: 502, headers: responseHeaders })
  }
})
