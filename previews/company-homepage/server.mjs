import { createServer } from 'node:http'
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { companyCopyFields, normalizeCompanyCopy } from '../../shared/company-homepage-copy.mjs'

const deriveKey = promisify(scrypt)
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
const maxAge = 60 * 60 * 24 * 2
const cookieName = 'kruk_review'
const headers = {
  'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

function loginPage(message = '') {
  return `<!doctype html><html lang="et"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Krük-Krük — privaatne eelvaade</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:#ece8dd;color:#252923;font:16px/1.6 system-ui,sans-serif;padding:24px}main{width:100%;max-width:390px}i{display:block;width:24px;height:5px;background:#a53529;margin-bottom:24px}h1{font-size:42px;letter-spacing:-2px;line-height:1.1;margin:0 0 12px}p{color:#64665c;margin:0 0 32px}label{display:block;font-size:14px;font-weight:600;margin:24px 0 8px}input,button{width:100%;min-height:52px;border-radius:4px;font:inherit}input{padding:12px 14px;border:1px solid #25292355;background:#f6f3eb;color:#252923}input:focus{outline:2px solid #a53529;outline-offset:2px}button{margin-top:16px;border:0;background:#252923;color:#ece8dd;font-weight:600;cursor:pointer}button:hover{background:#3b4036}.error{color:#a53529;margin:16px 0 0;font-size:14px}small{display:block;margin-top:24px;color:#64665c;font-size:13px}
</style></head><body><main><i aria-hidden="true"></i><h1>Krük-Krük</h1><p>Kodulehe privaatne eelvaade.</p><form action="/login" method="post"><label for="password">Parool</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200" autofocus><button type="submit">Ava koduleht</button>${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ''}</form><small>Siin saad kodulehe üle vaadata ja tekste muuta.</small></main></body></html>`
}

async function readBody(req, limit = 100000) {
  let length = 0
  const chunks = []
  for await (const chunk of req) {
    length += chunk.length
    if (length > limit) throw Object.assign(new Error('Päring on liiga suur.'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createReviewServer({ passwordHash, sessionSecret, load, save, assets = path.resolve('dist-company-preview'), secureCookies = true }) {
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash || '') || !sessionSecret || sessionSecret.length < 40) throw new Error('Preview secrets are missing or invalid; refusing to start.')
  const [, salt, digest] = passwordHash.split(':')
  const signingKey = `${sessionSecret}:${passwordHash}` // Password rotation revokes all existing sessions.
  const sign = payload => createHmac('sha256', signingKey).update(payload).digest('base64url')
  const validSession = req => {
    const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || ''
    const [expires, nonce, signature] = cookie.split('.')
    if (!/^\d+$/.test(expires || '') || !/^[a-f0-9]{32}$/.test(nonce || '') || !signature) return false
    if (Number(expires) < Date.now() / 1000 || Number(expires) > Date.now() / 1000 + maxAge + 60) return false
    const expected = Buffer.from(sign(`${expires}.${nonce}`))
    const actual = Buffer.from(signature)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }
  const cookie = (value, age = maxAge) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies ? '; Secure' : ''}`
  const attempts = []
  const send = (res, status, body, type = 'text/html; charset=utf-8', extra = {}) => {
    res.writeHead(status, { ...headers, 'Content-Type': type, ...(secureCookies ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}), ...extra })
    res.end(body)
  }
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'https://preview.invalid')
    const json = (status, value) => send(res, status, JSON.stringify(value), 'application/json; charset=utf-8')
    try {
      if (url.pathname === '/healthz' && ['GET', 'HEAD'].includes(req.method)) return send(res, 200, 'ok', 'text/plain')
      if (url.pathname === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain')
      if (!['GET', 'HEAD', 'POST', 'PUT'].includes(req.method)) return json(405, { error: 'Meetod ei ole lubatud.' })
      if (['POST', 'PUT'].includes(req.method)) {
        let origin
        try { origin = new URL(req.headers.origin || '').host } catch { /* Require a same-origin browser request. */ }
        if (origin !== req.headers.host || req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Päringu päritolu ei ole lubatud.' })
      }
      if (url.pathname === '/login' && req.method === 'POST') {
        const now = Date.now()
        while (attempts.length && attempts[0] < now - 15 * 60_000) attempts.shift()
        // Shared, bounded limit: cannot be bypassed by spoofed proxy/IP headers.
        if (attempts.length >= 30) return send(res, 429, loginPage('Liiga palju katseid. Proovi 15 minuti pärast uuesti.'), undefined, { 'Retry-After': '900' })
        attempts.push(now)
        const password = new URLSearchParams(await readBody(req, 2000)).get('password') || ''
        const key = await deriveKey(password.slice(0, 200), salt, 64)
        if (!timingSafeEqual(key, Buffer.from(digest, 'hex'))) return send(res, 401, loginPage('Parool ei ole õige. Proovi uuesti.'))
        const payload = `${Math.floor(now / 1000) + maxAge}.${randomBytes(16).toString('hex')}`
        return send(res, 303, '', undefined, { Location: '/', 'Set-Cookie': cookie(`${payload}.${sign(payload)}`) })
      }
      if (url.pathname === '/logout' && req.method === 'POST') return send(res, 303, '', undefined, { Location: '/', 'Set-Cookie': cookie('', 0) })
      if (!validSession(req)) {
        if (url.pathname.startsWith('/api/')) return json(401, { error: 'Seanss on aegunud. Ava leht uues sakis ja sisesta parool, seejärel proovi siin uuesti salvestada.' })
        return send(res, 401, req.method === 'HEAD' ? '' : loginPage())
      }
      if (url.pathname === '/api/homepage') {
        if (req.method === 'GET') return json(200, await load())
        if (req.method === 'PUT') {
          if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Oodatud on JSON.' })
          let body
          try { body = JSON.parse(await readBody(req)) } catch { return json(400, { error: 'Vigane päring.' }) }
          if (!Number.isSafeInteger(body.revision) || body.revision < 1 || !body.copy || typeof body.copy !== 'object' || Array.isArray(body.copy)) return json(400, { error: 'Vigased tekstiandmed.' })
          if (Object.entries(body.copy).some(([key, value]) => !Object.hasOwn(companyCopyFields, key) || typeof value !== 'string' || value.length > companyCopyFields[key][1])) return json(400, { error: 'Tekst on liiga pikk või väli on tundmatu.' })
          const copy = normalizeCompanyCopy(body.copy)
          if (copy.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(copy.email.trim())) return json(400, { error: 'Kontrolli e-posti aadressi.' })
          return json(200, await save(copy, body.revision))
        }
        return json(405, { error: 'Meetod ei ole lubatud.' })
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: 'Meetod ei ole lubatud.' })
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1)
      const file = path.resolve(assets, relative)
      if (!file.startsWith(`${path.resolve(assets)}${path.sep}`) || relative.split('/').some(part => part.startsWith('.'))) return json(404, { error: 'Lehte ei leitud.' })
      const info = await stat(file).catch(() => null)
      if (!info?.isFile()) return json(404, { error: 'Lehte ei leitud.' })
      const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream'
      return send(res, 200, req.method === 'HEAD' ? '' : await readFile(file), type)
    } catch (error) {
      return json(error.status || 503, { error: error.status === 409 ? error.message : 'Teenusega ei saanud ühendust. Sinu muudatused on alles; proovi uuesti.' })
    }
  })
}

export function reviewBackend(env) {
  const url = env.SUPABASE_URL?.replace(/\/$/, '')
  const key = env.SUPABASE_ANON_KEY
  const accessKey = env.COMPANY_REVIEW_ACCESS_KEY
  if (!url || !key || !accessKey) throw new Error('Review storage is not configured.')
  const request = async (resource, body) => {
    const response = await fetch(`${url}/rest/v1/${resource}`, {
      method: body ? 'POST' : 'GET', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw Object.assign(new Error(response.status === 409 ? 'Tekste on vahepeal teises aknas muudetud. Kopeeri oma muudatused ja laadi leht uuesti.' : 'Storage unavailable'), { status: response.status === 409 ? 409 : 503 })
    return response.json()
  }
  return {
    load: async () => {
      const review = await request('rpc/read_company_homepage_review', { access_key: accessKey })
      const [stores, rows] = await Promise.all([
        request(`public_storefronts?select=id,name,slug,is_published,payment_provider,payment_status,shipping,settings&id=eq.${encodeURIComponent(review.storeId)}&limit=1`),
        request(`products?select=id,name,slug,image_url,gallery,description,price,sale_price,alt,image_variants&store_id=eq.${encodeURIComponent(review.storeId)}&order=created_at.desc`),
      ])
      if (!stores[0]) throw new Error('Store unavailable')
      return {
        store: { ...stores[0], settings: { ...stores[0].settings, companyHomepage: review.copy } }, revision: review.revision,
        shopUrl: `https://${stores[0].slug}.poeruum.ee/`,
        products: rows.map(row => ({ id: row.id, name: row.name, slug: row.slug, image: row.image_url, gallery: row.gallery, description: row.description,
          price: row.price == null ? undefined : Number(row.price), salePrice: row.sale_price == null ? undefined : Number(row.sale_price), alt: row.alt, imageVariants: row.image_variants })),
      }
    },
    save: (copy, revision) => request('rpc/save_company_homepage_review', { access_key: accessKey, expected_revision: revision, next_copy: copy }),
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createReviewServer({ passwordHash: process.env.COMPANY_REVIEW_PASSWORD_HASH, sessionSecret: process.env.COMPANY_REVIEW_ACCESS_KEY, ...reviewBackend(process.env) })
  server.listen(Number(process.env.PORT || 4190), '0.0.0.0', () => console.log('Private company homepage is listening.'))
}
