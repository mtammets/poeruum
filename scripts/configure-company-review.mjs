import { config } from 'dotenv'
import { randomBytes, scryptSync, createHash } from 'node:crypto'
import { readFile, writeFile, access } from 'node:fs/promises'

config({ path: '.env', quiet: true })
const action = process.argv[2] || 'status'
const localSecrets = '.env.company-preview'
const deploymentFile = 'previews/company-homepage/deployment.json'
const branch = 'codex/kruk-client-preview'
const migrationVersion = '202610300001'
const quote = value => `'${String(value).replace(/'/g, "''")}'`
const required = name => { if (!process.env[name]) throw new Error(`Missing ${name}`); return process.env[name] }
const render = async (route, method = 'GET', body) => {
  const response = await fetch(`https://api.render.com/v1${route}`, { method, headers: { Authorization: `Bearer ${required('RENDER_API_KEY')}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  if (!response.ok) throw new Error(`Render ${route}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`)
  return response.json()
}
const query = async sql => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${required('SUPABASE_PROJECT_REF')}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${required('SUPABASE_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql, read_only: false }),
  })
  if (!response.ok) throw new Error(`Supabase database: HTTP ${response.status} ${(await response.text()).slice(0, 400)}`)
  return response.json()
}
const secretFileExists = await access(localSecrets).then(() => true, () => false)
if (action === 'prepare' && !secretFileExists) {
  const password = `Kruk-${randomBytes(9).toString('base64url')}`
  const salt = randomBytes(16).toString('hex')
  await writeFile(localSecrets, [
    '# Private review credentials. Ignored by Git; do not publish this file.',
    `COMPANY_REVIEW_PASSWORD=${password}`,
    `COMPANY_REVIEW_PASSWORD_HASH=scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
    `COMPANY_REVIEW_ACCESS_KEY=${randomBytes(32).toString('hex')}`, '',
  ].join('\n'), { mode: 0o600, flag: 'wx' })
}
config({ path: localSecrets, quiet: true })
if (action === 'prepare') console.log('Private review credentials prepared in the ignored local environment file; no values printed.')
else if (action === 'database') {
  const sql = await readFile(`supabase/migrations/${migrationVersion}_company_homepage_reviews.sql`, 'utf8')
  const [state] = await query(`select exists(select 1 from supabase_migrations.schema_migrations where version = ${quote(migrationVersion)}) as applied, to_regclass('public.company_homepage_reviews') is not null as present`)
  if (state.applied !== state.present) throw new Error('Migration history and review schema disagree; refusing to change existing data.')
  if (!state.applied) await query(`begin; ${sql}\ninsert into supabase_migrations.schema_migrations(version, name, statements) values (${quote(migrationVersion)}, 'company_homepage_reviews', array[${quote(sql)}]); commit;`)
  const hash = createHash('sha256').update(required('COMPANY_REVIEW_ACCESS_KEY')).digest('hex')
  await query(`insert into public.company_homepage_reviews(store_id, access_key_hash, copy)
    select id, ${quote(hash)}, coalesce(settings->'companyHomepage','{}'::jsonb) from public.stores where slug = 'kruk-kruk'
    on conflict (store_id) do nothing`)
  const [check] = await query(`select exists(select 1 from public.company_homepage_reviews r join public.stores s on s.id=r.store_id where s.slug='kruk-kruk' and r.access_key_hash=${quote(hash)} and r.active) as ready,
    not has_table_privilege('anon','public.company_homepage_reviews','select') as private,
    not has_table_privilege('authenticated','public.company_homepage_reviews','update') as protected`)
  if (!Object.values(check).every(Boolean)) throw new Error('Private review storage did not pass its access checks.')
  console.log('Private review migration, draft and database access checks passed.')
} else if (action === 'deploy') {
  let deployment = await readFile(deploymentFile, 'utf8').then(JSON.parse, () => null)
  if (deployment?.serviceId) throw new Error('The preview service already exists. Inspect status and deploy its existing service ID.')
  const parent = await render(`/services/${required('RENDER_SERVICE_ID')}`)
  const existing = await render(`/services?name=kruk-kruk-eelvaade&limit=20`)
  if (existing.some(item => (item.service ?? item).name === 'kruk-kruk-eelvaade')) throw new Error('An existing review service must be reconciled before creating another.')
  const envVars = [
    ['COMPANY_REVIEW_PASSWORD_HASH', required('COMPANY_REVIEW_PASSWORD_HASH')],
    ['COMPANY_REVIEW_ACCESS_KEY', required('COMPANY_REVIEW_ACCESS_KEY')],
    ['SUPABASE_URL', required('VITE_SUPABASE_URL')],
    ['SUPABASE_ANON_KEY', required('VITE_SUPABASE_PUBLISHABLE_KEY')],
    ['NODE_VERSION', '22'],
  ].map(([key, value]) => ({ key, value }))
  const result = await render('/services', 'POST', {
    type: 'web_service', name: 'kruk-kruk-eelvaade', ownerId: parent.ownerId, repo: parent.repo, branch, autoDeployTrigger: 'off', envVars,
    serviceDetails: { runtime: 'node', plan: 'free', region: parent.serviceDetails.region, numInstances: 1, healthCheckPath: '/healthz',
      envSpecificDetails: { buildCommand: 'npm ci && npm run build:company-preview', startCommand: 'npm run start:company-preview' } },
  })
  deployment = { serviceId: result.service.id, url: result.service.serviceDetails.url, branch, deployId: result.deployId, plan: 'free' }
  await writeFile(deploymentFile, `${JSON.stringify(deployment, null, 2)}\n`)
  console.log(JSON.stringify(deployment))
} else if (action === 'status') {
  const deployment = JSON.parse(await readFile(deploymentFile, 'utf8'))
  const [service, deploys] = await Promise.all([render(`/services/${deployment.serviceId}`), render(`/services/${deployment.serviceId}/deploys?limit=1`)])
  const deploy = deploys[0]?.deploy
  console.log(JSON.stringify({ serviceId: service.id, url: service.serviceDetails.url, plan: service.serviceDetails.plan, deployId: deploy?.id, status: deploy?.status, commit: deploy?.commit?.id }))
} else throw new Error('Use prepare, database, deploy or status.')
