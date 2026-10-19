type Handler = (request: Request) => Response | Promise<Response>
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }

Deno.test('story interview enforces invitations, admin access, state transitions, retry safety and publication', async () => {
  const originalServe = Deno.serve, originalFetch = globalThis.fetch
  const values = { SUPABASE_URL: 'https://story-test.example.invalid', POERUUM_SUPABASE_SECRET_KEY: 'test-only', OPENAI_API_KEY: 'test-only', RATE_LIMIT_SALT: 'test-only' }
  const previous = new Map(Object.keys(values).map((key) => [key, Deno.env.get(key)]))
  const token = 'a'.repeat(64)
  const tokenHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const row: any = { id: 'c7310000-0000-4000-8000-000000000003', store_id: 'c7310000-0000-4000-8000-000000000002', token_hash: tokenHash,
    expires_at: '2099-10-18T00:00:00Z', status: 'interview', messages: [{ role: 'assistant', content: 'Kuidas alustasid?' }],
    draft: null, image_path: null, image_alt: '', body_image_path: null, body_image_alt: '', body_image_caption: '',
    version: 0, last_request_id: null, operation_id: null, busy_until: null }
  const store = { id: row.store_id, name: 'Savipood', slug: 'savipood', is_published: true, owner_id: 'c7310000-0000-4000-8000-000000000001', deleted_at: null }
  const excludedStores = [
    { ...store, id: crypto.randomUUID(), name: 'Avaldamata pood', is_published: false },
    { ...store, id: crypto.randomUUID(), name: 'Kustutatud pood', is_published: false, owner_id: null, deleted_at: '2026-10-01' },
    { ...store, id: crypto.randomUUID(), owner_id: null },
    { ...store, id: crypto.randomUUID(), deleted_at: '2026-10-01' },
  ]
  const draft = { title: 'Kruusist algas oma pood', intro: 'Liis alustas kodus.', opening: ['Esimene kruus oli sinine.'], quote: '', sections: [], imageCaption: '' }
  let handler: Handler | undefined, role = 'merchant', allowed = true, aiFailure = false, finish = false
  let modelCalls = 0, publishedCount = 0, uploads = 0
  let article: any = null, createdInvitation: any = null
  let aiBarrier: Promise<void> | null = null
  const removed: string[] = [], downloaded: string[] = []
  try {
    for (const [key, value] of Object.entries(values)) Deno.env.set(key, value)
    Deno.serve = ((callback: Handler) => { handler = callback; return {} }) as typeof Deno.serve
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input)), method = options?.method || 'GET'
      const body = typeof options?.body === 'string' ? JSON.parse(options.body) : null
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
      if (url.pathname.endsWith('/auth/v1/user')) return json({ id: 'c7310000-0000-4000-8000-000000000001', aud: 'authenticated', app_metadata: { role } })
      if (url.pathname.endsWith('/rpc/consume_rate_limit')) return json([{ allowed, remaining: 1, retry_after_seconds: 60 }])
      if (url.pathname.endsWith('/rpc/record_application_error')) return json(null)
      if (url.pathname.endsWith('/stores')) {
        const matches = [store, ...excludedStores].filter((candidate) =>
          (!url.searchParams.has('id') || url.searchParams.get('id') === `eq.${candidate.id}`)
          && (!url.searchParams.has('is_published') || url.searchParams.get('is_published') === `eq.${candidate.is_published}`)
          && (!url.searchParams.has('owner_id') || candidate.owner_id !== null)
          && (!url.searchParams.has('deleted_at') || candidate.deleted_at === null))
        return json(url.searchParams.has('id') ? matches[0] ?? null : matches)
      }
      if (url.pathname.endsWith('/story_interviews')) {
        if (method === 'POST') { createdInvitation = body; return json({ id: row.id }) }
        if (method === 'PATCH') {
          if (url.searchParams.has('operation_id') && url.searchParams.get('operation_id') !== `eq.${row.operation_id}`) return json(null)
          Object.assign(row, body)
          return json({ ...row })
        }
        if (url.searchParams.has('order')) return json([{ ...row, store: { name: store.name } },
          { ...row, id: crypto.randomUUID(), store_id: excludedStores[0].id, store: { name: excludedStores[0].name } }])
        return json(!url.searchParams.has('token_hash') || url.searchParams.get('token_hash') === `eq.${row.token_hash}` ? { ...row } : null)
      }
      if (url.pathname.endsWith('/directory_stories')) {
        if (url.searchParams.has('order')) return json(article ? [article] : [])
        return json(article && (!url.searchParams.has('is_published') || article.is_published) ? article : null)
      }
      if (url.pathname.endsWith('/rpc/claim_story_interview')) {
        if (body.access_hash !== row.token_hash || row.status === 'revoked') return json({ code: '42501' }, 403)
        if (body.expected_version !== row.version || (row.busy_until && Date.parse(row.busy_until) > Date.now())) return json({ code: '40001' }, 409)
        row.operation_id = body.request_id; row.busy_until = new Date(Date.now() + 120000).toISOString()
        return json({ ...row })
      }
      if (url.pathname.endsWith('/rpc/approve_story_interview')) {
        assert(role === 'admin' && row.status === 'pending_review' && row.draft && row.image_path, 'Published unreviewed interview')
        if (body.expected_version !== row.version) return json({ code: '40001' }, 409)
        if (!article) { publishedCount++; article = { id: row.id, slug: body.article_slug, story: body.article_document, image_path: row.image_path, body_image_path: row.body_image_path, is_published: true } }
        row.status = 'published'; row.version++; row.operation_id = null; row.busy_until = null
        return json(article)
      }
      if (url.pathname.includes('/storage/v1/object/sign/')) return json({ signedURL: `/object/sign/${url.pathname.split('/object/sign/')[1]}?token=private` })
      if (url.pathname.includes('/storage/v1/object/')) {
        if (method === 'POST') { uploads++; return json({ Key: 'test.webp' }) }
        if (method === 'DELETE') { removed.push(...body.prefixes); return json([]) }
        downloaded.push(url.pathname.split('/story-interviews/')[1])
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } })
      }
      if (url.origin === 'https://api.openai.com') {
        modelCalls++
        assert(body.store === false && body.text.format.strict === true, 'AI retention or schema missing')
        if (aiBarrier) await aiBarrier
        if (aiFailure) return json({ error: 'private provider error' }, 500)
        const result = body.text.format.name === 'merchant_story' ? draft : { question: finish ? '' : 'Milline oli sinu esimene kruus?', finished: finish }
        return json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] })
      }
      throw new Error(`Unexpected request ${method} ${url.pathname}`)
    }
    await import('../supabase/functions/story-interview/index.ts')
    assert(handler, 'No handler')
    const call = (body: Record<string, unknown>, auth = false) => handler!(new Request('https://edge.example.invalid/story-interview', { method: 'POST', headers: auth ? { Authorization: 'Bearer test-admin' } : {}, body: JSON.stringify(body) }))
    const mutate = (action: string, extra: Record<string, unknown> = {}) => call({ action, token, version: row.version, requestId: crypto.randomUUID(), ...extra })
    assert((await call({ action: 'admin-create', storeId: store.id })).status === 401, 'Anonymous creates invitation')
    assert((await call({ action: 'admin-create', storeId: store.id }, true)).status === 403, 'Merchant creates invitation')
    for (const action of ['admin-review', 'admin-approve']) {
      assert((await call({ action, id: row.id, token, version: row.version })).status === 401, 'Invitation grants admin access')
      assert((await call({ action, id: row.id, version: row.version }, true)).status === 403, 'Merchant reviews or approves a story')
    }
    role = 'admin'
    assert((await call({ action: 'admin-review', id: row.id }, true)).status === 409, 'Unsubmitted interview reviewed')
    assert((await call({ action: 'admin-approve', id: row.id, version: row.version }, true)).status === 409, 'Unsubmitted interview approved')
    const listing = await call({ action: 'admin-list' }, true)
    const listed = await listing.json()
    assert(listing.status === 200 && listed.stores.length === 1 && listed.stores[0].id === store.id, 'Store selector includes an unpublished or deleted store')
    assert(listed.interviews[1].store_name === excludedStores[0].name, 'Unpublishing a store loses its interview history name')
    for (const excluded of excludedStores) {
      assert((await call({ action: 'admin-create', storeId: excluded.id }, true)).status === 404, 'Ineligible store accepted for invitation')
    }
    assert(createdInvitation === null, 'Rejected store created an invitation')
    const invitation = await call({ action: 'admin-create', storeId: store.id }, true)
    const created = await invitation.json()
    assert(invitation.status === 200 && /^[a-f0-9]{64}$/.test(created.token), 'Admin invitation failed')
    assert(createdInvitation.messages[0].content === 'Mis on sinu nimi?', 'Interview does not ask the name first')
    assert(createdInvitation.token_hash !== created.token && !JSON.stringify(createdInvitation).includes(created.token), 'Raw invitation persisted')
    assert((await call({ action: 'load', token: 'bad' })).status === 410, 'Malformed token accepted')
    assert((await call({ action: 'load', token: 'b'.repeat(64) })).status === 410, 'Wrong token accepted')
    const loaded = await call({ action: 'load', token })
    assert(loaded.status === 200 && !(await loaded.text()).includes(tokenHash), 'Private token hash leaked')
    assert((await mutate('publish')).status === 409 && publishedCount === 0, 'Premature publish accepted')
    assert((await mutate('submit')).status === 409 && publishedCount === 0, 'Premature submission accepted')
    assert((await mutate('generate')).status === 409 && modelCalls === 0, 'Premature generation billed')
    allowed = false
    assert((await mutate('answer', { answer: 'Tere' })).status === 429 && modelCalls === 0, 'Rate-limited request billed')
    allowed = true
    assert((await mutate('answer', { answer: 'Alustasin kodus.' })).status === 409, 'Legacy interview answer silently used as a name')
    assert((await mutate('name', { answer: 'x'.repeat(121) })).status === 400, 'Oversized name accepted')
    assert(row.operation_id === null, 'Invalid request kept a lease')
    const nameRequestId = crypto.randomUUID()
    assert((await mutate('name', { answer: 'Liis', requestId: nameRequestId })).status === 200 && modelCalls === 0, 'Name entry unnecessarily called AI')
    assert((await mutate('name', { answer: 'Liis', requestId: nameRequestId, version: 0 })).status === 200, 'Name retry failed')
    assert(row.messages.length === 3 && row.messages[1].content === 'Liis' && row.messages[2].content === 'Kuidas alustasid?', 'Name capture lost existing question')
    assert((await mutate('finish')).status === 400, 'Name counted as interview content')
    assert((await mutate('answer', { answer: 'x'.repeat(4001) })).status === 400, 'Oversized answer accepted')
    aiFailure = true
    const failed = await mutate('answer', { answer: 'Alustasin kodus.' })
    assert(failed.status === 500 && !(await failed.text()).includes('private provider'), 'Provider detail leaked')
    assert(row.version === 1 && row.messages.length === 3 && row.operation_id === null, 'AI failure changed transcript')
    aiFailure = false
    const requestId = crypto.randomUUID()
    let release!: () => void
    aiBarrier = new Promise<void>((resolve) => { release = resolve })
    const first = mutate('answer', { answer: 'Alustasin kodus.', requestId })
    // Wait for the in-flight operation to reach the provider, then race a second tab.
    for (let i = 0; i < 100 && !row.operation_id; i++) await new Promise((resolve) => setTimeout(resolve, 1))
    const raced = await mutate('answer', { answer: 'Teine vastus.' })
    assert(raced.status === 409, 'Concurrent AI operation accepted')
    release(); aiBarrier = null
    assert((await first).status === 200, 'Answer failed')
    const callsBeforeRetry = modelCalls
    assert((await mutate('answer', { answer: 'Alustasin kodus.', requestId, version: 0 })).status === 200, 'Idempotent retry failed')
    assert(modelCalls === callsBeforeRetry && row.messages.filter((m: any) => m.role === 'user' && m.kind !== 'name').length === 1, 'Retry duplicated answer')
    assert((await mutate('finish')).status === 400, 'Premature finish accepted')
    finish = true
    assert((await mutate('answer', { answer: 'Esimene kruus oli sinine.' })).status === 200 && row.status === 'photo', 'Interview did not finish')
    assert((await mutate('upload', { image: 'data:image/png;base64,PHNjcmlwdD4=' })).status === 400 && uploads === 0, 'Invalid image stored')
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLe0AAAAASUVORK5CYII='
    assert((await mutate('upload', { image: png })).status === 200 && uploads === 1, 'Photo upload failed')
    const coverPath = row.image_path
    assert((await mutate('upload', { image: png, slot: 'third' })).status === 400 && uploads === 1, 'An unsupported photo slot was stored')
    assert((await mutate('upload', { image: png, slot: 'body' })).status === 200 && uploads === 2, 'Second photo upload failed')
    const firstBodyPath = row.body_image_path
    const uploadedSnapshot = (await (await call({ action: 'load', token })).json()).interview
    assert(uploadedSnapshot.imageUrl !== uploadedSnapshot.bodyImageUrl && uploadedSnapshot.bodyImageUrl.includes(firstBodyPath), 'Both photo slots are not restored separately')
    assert(row.image_path === coverPath && !removed.includes(coverPath), 'Second photo replaced or deleted the cover')
    const privateImage = await handler!(new Request(`https://edge.example.invalid/story-interview?image=${row.id}`))
    assert(privateImage.status === 404, 'Draft image exposed publicly')
    assert((await handler!(new Request(`https://edge.example.invalid/story-interview?image=${row.id}&slot=body`))).status === 404, 'Second draft photo exposed publicly')
    assert((await mutate('generate')).status === 200 && row.status === 'preview', 'Article generation failed')
    assert((await mutate('save', { draft: { ...draft, title: '' }, imageAlt: 'Kruus' })).status === 400, 'Invalid article saved')
    assert((await mutate('save', { draft: { ...draft, title: 'Minu muudetud lugu' }, imageAlt: 'Sinine kruus' })).status === 200, 'Article edit failed')
    assert((await mutate('save', { draft: row.draft, imageAlt: 'Sinine kruus', bodyImageAlt: '', bodyImageCaption: '' })).status === 400, 'Empty second photo description accepted')
    assert((await mutate('save', { draft: row.draft, imageAlt: 'Sinine kruus', bodyImageAlt: 'Kruusid töötoas', bodyImageCaption: 'x'.repeat(301) })).status === 400, 'Oversized second caption accepted')
    assert((await mutate('save', { draft: row.draft, imageAlt: 'Sinine kruus', bodyImageAlt: 'Kruusid töötoas', bodyImageCaption: 'Foto: Liis' })).status === 200, 'Second photo metadata not saved')
    const replacementId = crypto.randomUUID()
    assert((await mutate('upload', { image: png, slot: 'body', requestId: replacementId })).status === 200, 'Second photo replacement failed')
    assert(row.body_image_path !== firstBodyPath && removed.includes(firstBodyPath) && !removed.includes(coverPath), 'Replacement removed the wrong photo')
    assert(row.body_image_alt === 'Kruusid töötoas' && row.body_image_caption === 'Foto: Liis', 'Replacing a photo lost its description')
    const uploadsBeforeRetry = uploads
    assert((await mutate('upload', { image: png, slot: 'body', requestId: replacementId, version: 0 })).status === 200 && uploads === uploadsBeforeRetry, 'Retry duplicated second upload')
    assert((await mutate('remove-image', { slot: 'cover' })).status === 400 && row.image_path === coverPath, 'Required cover can be removed')
    const removedBodyPath = row.body_image_path
    assert((await mutate('remove-image', { slot: 'body' })).status === 200 && row.body_image_path === null && row.body_image_alt === '' && row.body_image_caption === '', 'Second photo removal failed')
    assert(removed.includes(removedBodyPath) && !removed.includes(coverPath), 'Removal deleted the wrong photo')
    assert((await mutate('upload', { image: png, slot: 'body' })).status === 200, 'Second photo could not be added again')
    assert((await mutate('save', { draft: row.draft, imageAlt: 'Sinine kruus', bodyImageAlt: 'Kruusid töötoas', bodyImageCaption: 'Foto: Liis' })).status === 200, 'Second photo metadata not saved again')
    // Existing previews collect a missing name without losing the approved title or photo.
    row.messages = row.messages.filter((message: any) => message.kind !== 'name')
    const savedMessages = JSON.stringify(row.messages), savedImage = row.image_path
    assert((await (await call({ action: 'load', token })).json()).interview.needsName, 'Legacy preview skipped name collection')
    assert((await mutate('publish')).status === 409, 'Nameless preview published')
    aiFailure = true
    assert((await mutate('name', { answer: 'Liis' })).status === 500, 'Failed revision reported success')
    assert(JSON.stringify(row.messages) === savedMessages && row.draft.title === 'Minu muudetud lugu' && row.image_path === savedImage, 'Failed name revision lost draft data')
    aiFailure = false
    assert((await mutate('name', { answer: 'Liis' })).status === 200 && row.status === 'preview', 'Legacy preview did not resume')
    assert(row.draft.title === 'Minu muudetud lugu' && row.image_path === savedImage && row.image_alt === 'Sinine kruus', 'Name revision lost edits or photo')
    const submitId = crypto.randomUUID(), submissionVersion = row.version
    const submitted = await mutate('submit', { requestId: submitId })
    assert(submitted.status === 200 && row.status === 'pending_review' && article === null && publishedCount === 0, 'Submission published a story')
    assert((await submitted.json()).interview.publishedUrl === null, 'Submission exposed a public URL')
    assert((await mutate('submit', { requestId: submitId, version: submissionVersion })).status === 200 && row.version === submissionVersion + 1, 'Submission retry duplicated changes')
    assert((await mutate('publish')).status === 200 && article === null, 'Legacy publish bypassed approval')
    // An old tab submitting a different preview must also enter the review queue.
    row.status = 'preview'
    assert((await mutate('publish')).status === 200 && row.status === 'pending_review' && article === null, 'Legacy preview published directly')
    for (const action of ['save', 'upload', 'remove-image', 'generate', 'name', 'answer', 'finish']) {
      assert((await mutate(action, { draft, imageAlt: 'Changed', image: png, slot: 'body', answer: 'Changed' })).status === 409, 'Submitted story changed before review')
    }
    assert((await handler!(new Request(`https://edge.example.invalid/story-interview?image=${row.id}`))).status === 404, 'Pending cover exposed')
    assert((await handler!(new Request(`https://edge.example.invalid/story-interview?image=${row.id}&slot=body`))).status === 404, 'Pending body photo exposed')
    assert((await call({ action: 'admin-visibility', id: row.id, published: true }, true)).status === 404 && publishedCount === 0, 'Visibility action bypassed review')
    const review = await call({ action: 'admin-review', id: row.id }, true)
    const reviewed = (await review.json()).interview
    assert(review.status === 200 && reviewed.draft.title === row.draft.title && reviewed.bodyImageUrl && !reviewed.publishedUrl, 'Admin cannot inspect the pending story and both photos')
    assert((await call({ action: 'admin-approve', id: row.id, version: row.version - 1 }, true)).status === 409 && publishedCount === 0, 'Stale approval accepted')
    row.expires_at = '2000-01-01'
    assert((await call({ action: 'admin-review', id: row.id }, true)).status === 200, 'Expired invitation blocked admin review')
    const publish = await call({ action: 'admin-approve', id: row.id, version: reviewed.version }, true)
    assert(publish.status === 200 && article.story.title === 'Minu muudetud lugu' && article.store_id === undefined, 'Approval lost submitted text or failed after link expiry')
    assert(article.body_image_path === row.body_image_path && article.story.bodyImage.src.endsWith('&slot=body') && article.story.bodyImage.alt === 'Kruusid töötoas' && article.story.bodyImage.caption === 'Foto: Liis', 'Publication lost the second photo')
    assert(!JSON.stringify(article.story).includes(row.body_image_path), 'Private storage path leaked into public article')
    assert((await call({ action: 'admin-approve', id: row.id, version: reviewed.version }, true)).status === 200 && publishedCount === 1, 'Approval duplicated publication')
    row.expires_at = '2099-01-01'
    assert((await mutate('submit')).status === 200 && publishedCount === 1, 'Submission retry changed published story')
    const publicImage = await handler!(new Request(`https://edge.example.invalid/story-interview?image=${row.id}`))
    assert(publicImage.status === 200 && publicImage.headers.get('Content-Type') === 'image/webp', 'Published photo unavailable')
    assert((await handler!(new Request(`https://edge.example.invalid/story-interview?image=${row.id}&slot=body`))).status === 200 && downloaded.at(-1) === article.body_image_path, 'Published second photo unavailable or wrong')
    assert((await handler!(new Request(`https://edge.example.invalid/story-interview?image=${row.id}&slot=third`))).status === 404, 'Unknown public photo slot accepted')
    const publishedBodyPath = article.body_image_path
    article.body_image_path = null
    assert((await handler!(new Request(`https://edge.example.invalid/story-interview?image=${row.id}&slot=body`))).status === 404, 'Missing second photo returns cover')
    article.body_image_path = publishedBodyPath
    article.is_published = false
    assert((await handler!(new Request(`https://edge.example.invalid/story-interview?image=${row.id}`))).status === 404, 'Hidden photo exposed')
    assert((await handler!(new Request(`https://edge.example.invalid/story-interview?image=${row.id}&slot=body`))).status === 404, 'Hidden second photo exposed')
    row.expires_at = '2000-01-01'
    assert((await call({ action: 'load', token })).status === 410, 'Expired invitation accepted')
    row.expires_at = '2099-01-01'; row.status = 'revoked'
    assert((await call({ action: 'load', token })).status === 410, 'Revoked invitation accepted')
  } finally {
    Deno.serve = originalServe; globalThis.fetch = originalFetch
    for (const [key, value] of previous) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value) }
  }
})
