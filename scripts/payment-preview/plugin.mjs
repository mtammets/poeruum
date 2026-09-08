import { randomUUID } from 'node:crypto'

const json = (response, data, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(data))
}
const readJson = async (request) => {
  let raw = ''
  for await (const chunk of request) {
    raw += chunk
    if (raw.length > 64 * 1024) throw new Error('Liiga suur eelvaate päring.')
  }
  return raw ? JSON.parse(raw) : {}
}
export const isAllowedPreviewRequest = (request, origin) => {
  if (request.headers.host !== new URL(origin).host) return false
  if (request.headers.origin && request.headers.origin !== origin) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  return true
}

export function paymentPreviewPlugin({ origin, getService }) {
  return {
    name: 'poeruum-isolated-payment-preview',
    enforce: 'pre',
    async closeBundle() {
      // Vite handles SIGTERM and stdin closure itself. Put resource cleanup in
      // its awaited shutdown hook so it cannot exit before Stripe is finished.
      const result = await getService()?.cleanup()
      if (result?.failed) {
        console.error(`Stripe’i testkontode koristamine ebaõnnestus. Kustuta need testkeskkonnas: ${result.remaining.join(', ')}`)
        process.exitCode = 1
      }
    },
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/lib/supabase.ts')) {
        return code.replace('auth: { persistSession:', "auth: { storage: window.sessionStorage, storageKey: 'poeruum-preview-auth', persistSession:")
      }
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (context.path !== '/index.html' && context.path !== '/') return html
        const id = new URL(context.originalUrl ?? '/', origin).searchParams.get('preview_session')
        if (!id || !/^[a-f0-9-]{36}$/.test(id)) return html
        return html.replace('<script type="module" src="/src/main.tsx"></script>', `<script type="module">
          const response = await fetch('/__preview/sessions/${id}/auth');
          if (response.ok) {
            sessionStorage.setItem('poeruum-preview-auth', JSON.stringify(await response.json()));
            await import('/src/main.tsx');
          } else {
            document.getElementById('root').textContent = 'Eelvaate katse aegus. Ava olukord uuesti eelvaate menüüst.';
          }
        </script>`)
      },
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', origin)
        const path = url.pathname
        const isControl = path.startsWith('/__preview/')
        const isBackend = /^\/(auth|rest|functions|storage)\/v1\//.test(path)
        if (!isControl && !isBackend) return next()
        if (!isAllowedPreviewRequest(request, origin)) return json(response, { error: 'Eelvaade on saadaval ainult oma kohaliku serveri kaudu.' }, 403)
        const service = getService()
        if (!service) return json(response, { error: 'Eelvaade käivitub. Proovi hetke pärast uuesti.' }, 503)
        try {
          if (path === '/__preview/config' && request.method === 'GET') return json(response, service.configuration)
          if (path === '/__preview/sessions' && request.method === 'POST') {
            const session = service.createSession(await readJson(request))
            return json(response, { id: session.id, url: session.kind === 'app'
              ? `/?preview_session=${session.id}`
              : `/previews/stripe-frame.html?session=${session.id}` })
          }
          const match = path.match(/^\/__preview\/sessions\/([a-f0-9-]{36})\/(auth|stripe)$/)
          if (match) {
            const session = service.getSession(match[1])
            if (match[2] === 'auth' && request.method === 'GET') return json(response, service.authSession(session))
            if (match[2] === 'stripe' && request.method === 'POST') {
              const body = await readJson(request)
              return json(response, await service.stripeAction(session, body.action, body.mode))
            }
          }
          if (isControl) return json(response, { error: 'Tundmatu eelvaate toiming.' }, 404)
          if (path === '/auth/v1/token' && request.method === 'POST') {
            const body = await readJson(request)
            const session = body.refresh_token ? service.getSession(body.refresh_token) : service.fromAuthorization(request.headers.authorization)
            return json(response, service.authSession(session))
          }
          if (path === '/auth/v1/logout') return json(response, {})
          if (path === '/storage/v1/object/public/product-images/preview.svg') {
            response.writeHead(200, { 'Content-Type': 'image/svg+xml' })
            return response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#e8e6d7"/><ellipse cx="294" cy="453" rx="153" ry="27" fill="#d2d0bd"/><path d="M360 240h45c105 0 105 155 0 155h-35" fill="none" stroke="#a68563" stroke-width="34"/><path d="M152 211h239v196q0 44-119 44t-120-44Z" fill="#bf9b77"/><ellipse cx="272" cy="211" rx="120" ry="35" fill="#e4c5a4"/><ellipse cx="272" cy="211" rx="100" ry="23" fill="#7e6249"/></svg>')
          }
          if (path === '/rest/v1/platform_settings') return json(response, null)
          if (path === '/functions/v1/report-client-error') return json(response, { ok: true })
          const session = service.fromAuthorization(request.headers.authorization)
          if (path === '/auth/v1/user') return json(response, session.user)
          if (path === '/functions/v1/stripe-connect') {
            const body = await readJson(request)
            return json(response, await service.stripeAction(session, body.action, body.mode))
          }
          const rows = (data) => json(response, request.headers.accept?.includes('vnd.pgrst.object') ? data[0] ?? null : data)
          const filter = (data) => data.filter((item) => !url.searchParams.get('id')?.startsWith('eq.') || item.id === url.searchParams.get('id').slice(3))
          if (path === '/rest/v1/stores') {
            if (request.method === 'PATCH' || request.method === 'POST') {
              const body = await readJson(request)
              for (const key of ['name', 'slug', 'shipping', 'settings']) if (body[key] !== undefined) session.store[key] = body[key]
            } else if (request.method !== 'GET') return json(response, { error: 'Toiming ei ole selles eelvaates saadaval.' }, 405)
            const owner = url.searchParams.get('owner_id')
            if (owner && owner !== `eq.${session.user.id}`) return rows([])
            return rows(filter([session.store]))
          }
          if (path === '/rest/v1/products') {
            if (request.method === 'DELETE') session.products = session.products.filter((item) => item.id !== url.searchParams.get('id')?.slice(3))
            else if (request.method === 'POST') session.products.push({ ...await readJson(request), id: randomUUID(), store_id: session.store.id })
            else if (request.method === 'PATCH') {
              const body = await readJson(request)
              filter(session.products).forEach((item) => Object.assign(item, body))
            }
            return rows(filter(session.products))
          }
          if (path === '/rest/v1/support_conversations') return rows(filter(session.conversations))
          if (path === '/rest/v1/support_messages') return rows(session.messages)
          if (path === '/functions/v1/support-actions') {
            const body = await readJson(request)
            if (body.action !== 'create') return json(response, { error: 'Tugivestlus on selles eelvaates näidis.' }, 400)
            const conversation = { id: randomUUID(), subject: body.subject, category: body.category, status: 'open', last_message_at: new Date().toISOString(), last_message_preview: body.body }
            session.conversations.push(conversation)
            session.messages.push({ id: randomUUID(), conversation_id: conversation.id, sender_kind: 'user', body: body.body, created_at: new Date().toISOString() })
            return json(response, { id: conversation.id })
          }
          if (path.startsWith('/rest/v1/rpc/')) {
            const rpc = path.split('/').pop()
            if (rpc === 'publish_store') {
              if (session.store.payment_status !== 'connected' || !session.products.length) return json(response, { message: 'Enne avaldamist ühenda maksed ja lisa esimene toode.' }, 400)
              session.store.is_published = true
              session.store.settings.onboardingStep = 'complete'
              return json(response, session.store)
            }
            if (rpc === 'unpublish_store') { session.store.is_published = false; return json(response, session.store) }
            if (['touch_user_presence', 'leave_user_presence', 'touch_onboarding_activity', 'mark_support_conversation_read'].includes(rpc)) return json(response, null)
            if (['storefront_seo_catalog', 'resolve_store_slug_for_hostname'].includes(rpc)) return json(response, [])
          }
          if (request.method === 'GET' && path.startsWith('/rest/v1/')) return rows([])
          return json(response, { error: 'See toiming ei kuulu maksete eelvaatesse.', message: 'See toiming ei kuulu maksete eelvaatesse.' }, 400)
        } catch (error) {
          return json(response, { error: error.message, message: error.message }, 400)
        }
      })
    },
  }
}
