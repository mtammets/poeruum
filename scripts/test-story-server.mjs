import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const story = { slug: 'merchant-story', title: 'Savi & käed <lugu>', intro: 'Päris kaupmehe lugu.', opening: ['Üks kruus.'], quote: '', sections: [],
  imageCaption: '', imageAlt: 'Kruus', image: 'https://example.invalid/photo.webp', category: 'Meie kaupmehed', author: 'Savipood',
  storeName: 'Savipood', storeSlug: 'savipood', publishedAt: '2026-10-18' }
let visible = true
const backend = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  res.writeHead(200, { 'Content-Type': 'application/json' })
  if (url.pathname.endsWith('/directory_stories')) {
    assert.equal(url.searchParams.get('is_published'), 'eq.true')
    const found = visible && (!url.searchParams.has('slug') || url.searchParams.get('slug') === `eq.${story.slug}`)
    return res.end(JSON.stringify(found ? url.searchParams.get('select') === 'slug' ? [{ slug: story.slug }] : [{ story }] : []))
  }
  return res.end('[]')
})
backend.listen(0, '127.0.0.1'); await once(backend, 'listening')
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
const port = probe.address().port
await new Promise((resolve) => probe.close(resolve))
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port),
  VITE_SUPABASE_URL: `http://127.0.0.1:${backend.address().port}`, VITE_SUPABASE_PUBLISHABLE_KEY: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] })
const get = (path, host = 'kaubamaja.poeruum.ee') => new Promise((resolve, reject) => {
  const req = request({ hostname: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
    let body = ''; res.on('data', (chunk) => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
  }); req.on('error', reject); req.end()
})
try {
  await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Server did not start') })])
  const interview = await get('/lugu/', 'poeruum.ee')
  assert.equal(interview.status, 200)
  assert.equal(interview.headers['cache-control'], 'private, no-store')
  assert.equal(interview.headers['referrer-policy'], 'no-referrer')
  assert.equal(interview.headers['x-robots-tag'], 'noindex, nofollow')
  assert.match(interview.body, /Sinu lugu — Poeruum/)
  const article = await get('/lood/merchant-story/')
  assert.equal(article.status, 200)
  assert.match(article.body, /Savi &amp; käed &lt;lugu&gt;/)
  assert.match(article.body, /content="https:\/\/example.invalid\/photo.webp"/)
  assert.match(article.body, /Külasta poodi/)
  assert.match(article.body, /id="poeruum-stories-data"/)
  assert.doesNotMatch(article.body, /class="directory-story-page__body-image"/)
  story.bodyImage = { src: 'https://example.invalid/detail.webp', alt: 'Savi & glasuur', caption: '<Detail> töötoast' }
  for (const sections of [[], [{ title: 'Esimene osa', paragraphs: ['Algus.'] }, { title: 'Teine osa', paragraphs: ['Jätk.'] }]]) {
    story.sections = sections
    const illustrated = (await get('/lood/merchant-story/')).body
    assert.equal((illustrated.match(/class="directory-story-page__body-image"/g) || []).length, 1)
    assert.match(illustrated, /alt="Savi &amp; glasuur" loading="lazy"/)
    assert.match(illustrated, /<figcaption>&lt;Detail&gt; töötoast<\/figcaption>/)
    if (sections.length) assert.ok(illustrated.indexOf('Esimene osa</h2>') < illustrated.indexOf('class="directory-story-page__body-image"') && illustrated.indexOf('class="directory-story-page__body-image"') < illustrated.indexOf('Teine osa</h2>'))
  }
  assert.equal((await get('/lood/merchant-story')).status, 301)
  assert.match((await get('/')).body, /\/lood\/merchant-story\//)
  const directory = (await get('/')).body
  assert.match(directory, /class="store-directory__hero directory-story-hero" id="poeruumi-lood"/)
  assert.match(directory, /id="featured-story-title">Savi &amp; käed &lt;lugu&gt;/)
  assert.match(directory, /Loe edasi/)
  assert.doesNotMatch(directory, /class="directory-stories__feature"|store-directory__hero-photo/)
  assert.match((await get('/sitemap.xml')).body, /\/lood\/merchant-story\//)
  assert.doesNotMatch((await get('/')).body, /see-uks-tass|See üks tass/)
  assert.doesNotMatch((await get('/sitemap.xml')).body, /see-uks-tass/)
  visible = false
  assert.equal((await get('/lood/merchant-story/')).status, 404)
  assert.doesNotMatch((await get('/sitemap.xml')).body, /merchant-story/)
  assert.equal((await get('/lood/see-uks-tass/')).status, 404)
  assert.equal((await get('/lood/see-uks-tass')).status, 404)
  assert.doesNotMatch((await get('/')).body, /id="poeruumi-lood"|see-uks-tass/)
  console.log('Story server routing, SEO, sitemap, privacy and unpublishing passed.')
} finally {
  server.kill('SIGTERM'); await once(server, 'exit')
  await new Promise((resolve) => backend.close(resolve))
}
