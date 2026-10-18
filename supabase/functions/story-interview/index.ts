import { createClient } from 'npm:@supabase/supabase-js@2'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'
import { addStoryName, decodeStoryImage, firstStoryQuestion, MAX_STORY_ANSWERS, NAME_QUESTION, nextStoryQuestion, parseStoryDraft, PHOTO_QUESTION, storyAnswerCount, storyRespondentName, validStoryId, validStoryToken, writeStoryDraft, type StoryMessage } from '../_shared/story-interview.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('POERUUM_SUPABASE_SECRET_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const hashToken = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, '0')).join('')
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
const articleUrl = (slug: string) => `https://kaubamaja.poeruum.ee/lood/${slug}/`
const unavailable = () => json({ error: 'See intervjuulink ei kehti enam. Küsi Poeruumilt uut linki.' }, 410)
const conflict = () => json({ error: 'Vestlus on vahepeal muutunud. Laadi see uuesti.' }, 409)

async function readBody(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 7_100_000) { await reader.cancel(); throw new Error('Request too large') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch { return null }
}

async function snapshot(client: ReturnType<typeof db>, row: any) {
  const [{ data: store, error: storeError }, { data: article, error: articleError }] = await Promise.all([
    client.from('stores').select('name,slug').eq('id', row.store_id).single(),
    client.from('directory_stories').select('slug,is_published').eq('interview_id', row.id).maybeSingle(),
  ])
  if (storeError || articleError) throw new Error('Story snapshot unavailable')
  const signedImage = async (path: string | null) => {
    if (!path) return null
    const { data, error } = await client.storage.from('story-interviews').createSignedUrl(path, 3600)
    if (error) throw new Error('Story image unavailable')
    return data.signedUrl
  }
  const [imageUrl, bodyImageUrl] = await Promise.all([signedImage(row.image_path), signedImage(row.body_image_path)])
  return { id: row.id, storeName: store!.name, storeSlug: store!.slug, status: row.status,
    version: row.version, messages: row.messages, needsName: row.status !== 'published' && !storyRespondentName(row.messages), draft: row.draft, imageUrl, imageAlt: row.image_alt,
    bodyImageUrl, bodyImageAlt: row.body_image_alt || '', bodyImageCaption: row.body_image_caption || '',
    publishedUrl: article?.is_published ? articleUrl(article.slug) : null, lastRequestId: row.last_request_id,
  }
}

async function adminAction(request: Request, client: ReturnType<typeof db>, body: any) {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Logi administraatorina sisse.' }, 401)
  const { data: { user }, error } = await client.auth.getUser(authorization.slice(7))
  if (error || !user) return json({ error: 'Logi administraatorina sisse.' }, 401)
  if (user.app_metadata?.role !== 'admin') return json({ error: 'Administraatori ligipääs on nõutud.' }, 403)
  const limit = await checkRateLimit(request, 'story-interview-admin', 40, 60, user.id)
  if (!limit.allowed) return rateLimitResponse(limit.retry_after_seconds, cors)
  if (body.action === 'admin-list') {
    const [stores, interviews, articles] = await Promise.all([
      client.from('stores').select('id,name,slug,is_published').eq('is_published', true).not('owner_id', 'is', null).is('deleted_at', null).order('name').limit(1000),
      client.from('story_interviews').select('id,store_id,status,expires_at,created_at,updated_at,store:stores(name)').order('created_at', { ascending: false }).limit(100),
      client.from('directory_stories').select('id,slug,is_published').order('published_at', { ascending: false }).limit(1000),
    ])
    if (stores.error || interviews.error || articles.error) throw new Error('Story administration unavailable')
    return json({ stores: stores.data, interviews: interviews.data.map(({ store, ...row }) => ({ ...row,
      store_name: (Array.isArray(store) ? store[0] : store)?.name || 'Pood',
      article: articles.data.find((article) => article.id === row.id) ?? null,
    })), aiAvailable: Boolean(Deno.env.get('OPENAI_API_KEY')?.trim()) })
  }
  if (body.action === 'admin-create') {
    if (!validStoryId(body.storeId)) return json({ error: 'Vali pood.' }, 400)
    if (!Deno.env.get('OPENAI_API_KEY')?.trim()) return json({ error: 'AI-intervjuu pole veel seadistatud.' }, 503)
    const { data: store, error: storeError } = await client.from('stores').select('id,name').eq('id', body.storeId)
      .eq('is_published', true).not('owner_id', 'is', null).is('deleted_at', null).maybeSingle()
    if (storeError) throw new Error('Store lookup failed')
    if (!store) return json({ error: 'Vali avaldatud pood.' }, 404)
    const token = newToken()
    const { data, error } = await client.from('story_interviews').insert({ store_id: store.id, created_by: user.id,
      token_hash: await hashToken(token), messages: [{ role: 'assistant', content: firstStoryQuestion(), kind: 'name' }],
    }).select('id').single()
    if (error) throw new Error('Invitation creation failed')
    return json({ id: data.id, token })
  }
  if (!validStoryId(body.id)) return json({ error: 'Vigane intervjuu.' }, 400)
  if (body.action === 'admin-renew' || body.action === 'admin-revoke') {
    const token = newToken()
    const patch = body.action === 'admin-renew'
      ? { token_hash: await hashToken(token), expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() }
      : { status: 'revoked' }
    const { data, error } = await client.from('story_interviews').update({ ...patch, updated_at: new Date().toISOString(), operation_id: null, busy_until: null })
      .eq('id', body.id).neq('status', 'revoked').neq('status', 'published').select('id').maybeSingle()
    if (error) throw new Error('Invitation update failed')
    if (!data) return json({ error: 'Seda intervjuud ei saa enam muuta.' }, 409)
    return json({ id: data.id, ...(body.action === 'admin-renew' ? { token } : {}) })
  }
  if (body.action === 'admin-visibility' && typeof body.published === 'boolean') {
    const { data, error } = await client.from('directory_stories').update({ is_published: body.published }).eq('id', body.id).select('id').maybeSingle()
    if (error) throw new Error('Story visibility update failed')
    return data ? json({ ok: true }) : json({ error: 'Lugu ei leitud.' }, 404)
  }
  return json({ error: 'Tundmatu tegevus.' }, 400)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const client = db()
  let operation: { id: string; requestId: string } | null = null
  let uploadedPath: string | null = null
  try {
    // Private Storage is exposed only through an existing, published article.
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams
      const id = params.get('image'), slot = params.get('slot') || 'cover'
      if (!validStoryId(id) || !['cover', 'body'].includes(slot)) return json({ error: 'Pilti ei leitud.' }, 404)
      const { data: story, error } = await client.from('directory_stories').select('image_path,body_image_path').eq('id', id).eq('is_published', true).maybeSingle()
      if (error) throw new Error('Public story image lookup failed')
      const imagePath = slot === 'body' ? story?.body_image_path : story?.image_path
      if (!imagePath) return json({ error: 'Pilti ei leitud.' }, 404)
      const { data, error: downloadError } = await client.storage.from('story-interviews').download(imagePath)
      if (downloadError || !data) throw new Error('Public story image download failed')
      return new Response(data, { headers: { ...cors, 'Content-Type': data.type || 'image/webp',
        'Cache-Control': 'public, max-age=60, s-maxage=300', 'X-Content-Type-Options': 'nosniff' } })
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    const inbound = await checkRateLimit(request, 'story-interview-inbound', 120, 60)
    if (!inbound.allowed) return rateLimitResponse(inbound.retry_after_seconds, cors)
    const body = await readBody(request)
    if (!body || typeof body.action !== 'string') return json({ error: 'Vigane päring.' }, 400)
    if (body.action.startsWith('admin-')) return await adminAction(request, client, body)
    if (!validStoryToken(body.token)) return unavailable()
    const accessHash = await hashToken(body.token)
    const limit = await checkRateLimit(request, 'story-interview', 45, 60, accessHash)
    if (!limit.allowed) return rateLimitResponse(limit.retry_after_seconds, cors)
    const { data: row, error } = await client.from('story_interviews').select('*').eq('token_hash', accessHash).maybeSingle()
    if (error) throw new Error('Interview lookup failed')
    if (!row || row.status === 'revoked' || Date.parse(row.expires_at) <= Date.now()) return unavailable()
    if (body.action === 'load') return json({ interview: await snapshot(client, row) })
    if (!['name', 'answer', 'finish', 'upload', 'remove-image', 'generate', 'save', 'publish'].includes(body.action)) return json({ error: 'Tundmatu tegevus.' }, 400)
    if (!validStoryId(body.requestId) || !Number.isInteger(body.version) || body.version < 0) return json({ error: 'Vigane päring.' }, 400)
    if (row.last_request_id === body.requestId || (row.status === 'published' && body.action === 'publish')) return json({ interview: await snapshot(client, row) })
    if (row.status === 'published') return json({ error: 'See lugu on juba valmis.' }, 409)
    const needsName = !storyRespondentName(row.messages)
    const answeringName = row.messages.length === 1 && row.messages[0].content === NAME_QUESTION
    const action = needsName && answeringName && body.action === 'answer' ? 'name' : body.action
    if (needsName && action !== 'name') return json({ error: 'Kirjuta kõigepealt oma nimi.' }, 409)
    const isAi = action === 'answer' || action === 'generate' || (action === 'name' && row.status === 'preview')
    const apiKey = Deno.env.get('OPENAI_API_KEY')?.trim()
    if (isAi && !apiKey) return json({ error: 'Intervjueerija pole praegu saadaval. Proovi veidi hiljem.' }, 503)
    if (isAi) {
      const daily = await checkRateLimit(request, 'story-interview-ai', 40, 86400, row.id)
      if (!daily.allowed) return rateLimitResponse(daily.retry_after_seconds, cors)
    }
    const { data: claimed, error: claimError } = await client.rpc('claim_story_interview', {
      target_id: row.id, access_hash: accessHash, expected_version: body.version, request_id: body.requestId,
    })
    if (claimError?.code === '42501') return unavailable()
    if (claimError?.code === '40001') return conflict()
    if (claimError) throw new Error('Interview claim failed')
    const current = Array.isArray(claimed) ? claimed[0] : claimed
    if (current.last_request_id === body.requestId) return json({ interview: await snapshot(client, current) })
    operation = { id: current.id, requestId: body.requestId }
    const { data: store, error: storeError } = await client.from('stores').select('name,slug').eq('id', current.store_id).single()
    if (storeError || !store) throw new Error('Interview store unavailable')
    const model = Deno.env.get('OPENAI_STORY_MODEL')?.trim() || 'gpt-5.4-mini'
    const messages = current.messages as StoryMessage[]
    const answers = storyAnswerCount(messages)
    let patch: Record<string, unknown> = {}
    if (action === 'name') {
      if (storyRespondentName(messages)) return conflict()
      if (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.length > 120) return json({ error: 'Kirjuta nimi kuni 120 tähemärgiga.' }, 400)
      const namedMessages = addStoryName(messages, body.answer.trim(), store.name)
      patch = { messages: namedMessages }
      if (current.status === 'preview') {
        const draft = parseStoryDraft(current.draft)
        if (!draft) return conflict()
        patch.draft = await writeStoryDraft(apiKey!, model, store.name, namedMessages, draft)
      }
    } else if (action === 'answer') {
      if (current.status !== 'interview' || answers >= MAX_STORY_ANSWERS) return conflict()
      if (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.length > 4000) return json({ error: 'Kirjuta vastus kuni 4000 tähemärgiga.' }, 400)
      const nextMessages: StoryMessage[] = [...messages, { role: 'user', content: body.answer.trim() }]
      const turn = answers + 1 >= MAX_STORY_ANSWERS ? { finished: true, question: '' }
        : await nextStoryQuestion(apiKey!, model, store.name, nextMessages)
      patch = { messages: [...nextMessages, { role: 'assistant', content: turn.finished ? PHOTO_QUESTION : turn.question }], status: turn.finished ? 'photo' : 'interview' }
    } else if (body.action === 'finish') {
      if (current.status !== 'interview' || answers < 3) return json({ error: 'Vastame enne veel mõnele küsimusele.' }, 400)
      patch = { status: 'photo', messages: [...messages, { role: 'assistant', content: PHOTO_QUESTION }] }
    } else if (body.action === 'upload') {
      if (!['photo', 'preview'].includes(current.status)) return conflict()
      if (body.slot !== undefined && !['cover', 'body'].includes(body.slot)) return json({ error: 'Vali avafoto või foto artikli sisse.' }, 400)
      const image = decodeStoryImage(body.image)
      if (!image) return json({ error: 'Vali JPG-, PNG- või WebP-pilt kuni 5 MB.' }, 400)
      uploadedPath = `${current.id}/${crypto.randomUUID()}.${image.extension}`
      const { error } = await client.storage.from('story-interviews').upload(uploadedPath, image.bytes, { contentType: image.mime, upsert: false })
      if (error) throw new Error('Interview image upload failed')
      patch = body.slot === 'body'
        ? { body_image_path: uploadedPath, body_image_alt: current.body_image_alt || store.name }
        : { image_path: uploadedPath, image_alt: current.image_alt || store.name }
    } else if (body.action === 'remove-image') {
      if (!['photo', 'preview'].includes(current.status)) return conflict()
      if (body.slot !== 'body') return json({ error: 'Avafoto on loo jaoks vajalik.' }, 400)
      patch = { body_image_path: null, body_image_alt: '', body_image_caption: '' }
    } else if (body.action === 'generate') {
      if (current.status !== 'photo' || !current.image_path || answers < 1) return conflict()
      patch = { draft: await writeStoryDraft(apiKey!, model, store.name, messages), status: 'preview' }
    } else if (body.action === 'save') {
      if (current.status !== 'preview') return conflict()
      const draft = parseStoryDraft(body.draft)
      if (!draft || typeof body.imageAlt !== 'string' || !body.imageAlt.trim() || body.imageAlt.length > 300) return json({ error: 'Kontrolli pealkirja, teksti ja pildi kirjeldust.' }, 400)
      patch = { draft, image_alt: body.imageAlt.trim() }
      if (current.body_image_path) {
        const alt = body.bodyImageAlt ?? current.body_image_alt
        const caption = body.bodyImageCaption ?? current.body_image_caption
        if (typeof alt !== 'string' || !alt.trim() || alt.length > 300 || typeof caption !== 'string' || caption.length > 300) return json({ error: 'Kontrolli teise foto kirjeldust ja allkirja.' }, 400)
        patch.body_image_alt = alt.trim(); patch.body_image_caption = caption.trim()
      }
    } else if (body.action === 'publish') {
      const draft = parseStoryDraft(current.draft)
      if (current.status !== 'preview' || !draft || !current.image_path) return conflict()
      const slug = `${store.slug}-${current.id.replaceAll('-', '')}`
      const document = { ...draft, slug, category: 'Meie kaupmehed', author: store.name, storeSlug: store.slug, storeName: store.name,
        image: `${Deno.env.get('SUPABASE_URL')}/functions/v1/story-interview?image=${current.id}`,
        imageAlt: current.image_alt || store.name, publishedAt: new Date().toISOString(),
        ...(current.body_image_path ? { bodyImage: {
          src: `${Deno.env.get('SUPABASE_URL')}/functions/v1/story-interview?image=${current.id}&slot=body`,
          alt: current.body_image_alt || store.name, caption: current.body_image_caption || '',
        } } : {}),
      }
      const { error } = await client.rpc('publish_story_interview', { target_id: current.id, access_hash: accessHash,
        request_id: body.requestId, article_slug: slug, article_document: document })
      if (error?.code === '42501') return unavailable()
      if (error?.code === '40001') return conflict()
      if (error) throw new Error('Story publication failed')
      operation = null
      return json({ interview: await snapshot(client, { ...current, status: 'published', version: current.version + 1, last_request_id: body.requestId }) })
    }
    const { data: saved, error: saveError } = await client.from('story_interviews').update({ ...patch,
      version: current.version + 1, last_request_id: body.requestId, updated_at: new Date().toISOString(), operation_id: null, busy_until: null,
    }).eq('id', current.id).eq('operation_id', body.requestId).eq('token_hash', accessHash)
      .gt('expires_at', new Date().toISOString()).neq('status', 'revoked').select('*').maybeSingle()
    if (saveError) throw new Error('Interview save failed')
    if (!saved) return conflict()
    operation = null
    uploadedPath = null
    // Replaced photos are no longer referenced; failure to remove can be retried by retention maintenance.
    const replacedPath = body.slot === 'body' ? current.body_image_path : current.image_path
    if (['upload', 'remove-image'].includes(body.action) && replacedPath) await client.storage.from('story-interviews').remove([replacedPath])
    return json({ interview: await snapshot(client, saved) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Request too large') return json({ error: 'Fail on liiga suur.' }, 413)
    await captureEdgeError('story-interview', error)
    return json({ error: 'Toiming ei õnnestunud. Proovi uuesti; salvestatud vestlus on alles.' }, 500)
  } finally {
    try {
      if (operation) await client.from('story_interviews').update({ operation_id: null, busy_until: null }).eq('id', operation.id).eq('operation_id', operation.requestId)
      // Do not remove a possibly committed upload after an ambiguous network error.
      if (uploadedPath && operation) {
        const { data, error } = await client.from('story_interviews').select('image_path,body_image_path').eq('id', operation.id).maybeSingle()
        if (!error && data && data.image_path !== uploadedPath && data.body_image_path !== uploadedPath) await client.storage.from('story-interviews').remove([uploadedPath])
      }
    } catch { /* The operation lease expires; cleanup must not discard the response. */ }
  }
})
