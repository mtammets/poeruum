import crypto from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import 'dotenv/config'

const action = process.argv[2]
const apiBase = 'https://api.supabase.com/v1'
const productionProjectRef = 'foctericixquaogwboqg'
const projectPrefix = 'poeruum-e2e-'

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const token = required('SUPABASE_ACCESS_TOKEN')
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

const api = async (path, options = {}) => {
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: { ...headers, ...options.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Supabase Management API ${response.status}: ${body.message ?? JSON.stringify(body)}`)
  return body
}

const writeEnvironment = async (values) => {
  const environmentFile = process.env.GITHUB_ENV
  for (const [name, value] of Object.entries(values)) {
    if (process.env.GITHUB_ACTIONS === 'true' && /PASSWORD|KEY/.test(name)) console.log(`::add-mask::${value}`)
    if (environmentFile) await appendFile(environmentFile, `${name}=${value}\n`)
  }
}

const waitForHealthyProject = async (projectRef) => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const project = await api(`/projects/${projectRef}`)
    if (project.status === 'ACTIVE_HEALTHY') return project
    if (['REMOVED', 'UNKNOWN', 'PAUSED'].includes(project.status)) {
      throw new Error(`Ajutise Supabase’i projekti olek on ${project.status}.`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  throw new Error('Ajutine Supabase’i projekt ei käivitunud 15 minuti jooksul.')
}

const createProject = async () => {
  const runId = process.env.GITHUB_RUN_ID?.trim() || Date.now().toString()
  const projectName = `${projectPrefix}${runId}`
  const databasePassword = `${crypto.randomBytes(30).toString('base64url')}aA1!`
  const project = await api('/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: projectName,
      organization_slug: required('SUPABASE_ORGANIZATION_ID'),
      region: 'eu-west-1',
      desired_instance_size: 'micro',
      db_pass: databasePassword,
    }),
  })
  const projectRef = String(project.ref ?? project.id ?? '')
  if (!/^[a-z]{20}$/.test(projectRef) || projectRef === productionProjectRef) {
    throw new Error('Supabase ei tagastanud turvalist ajutise projekti viidet.')
  }

  await writeEnvironment({
    EPHEMERAL_SUPABASE_PROJECT_REF: projectRef,
    EPHEMERAL_SUPABASE_PROJECT_NAME: projectName,
    SUPABASE_PROJECT_REF: projectRef,
    SUPABASE_DB_PASSWORD: databasePassword,
    VITE_SUPABASE_URL: `https://${projectRef}.supabase.co`,
  })
  await waitForHealthyProject(projectRef)

  const keys = await api(`/projects/${projectRef}/api-keys?reveal=true`)
  const publishableKey = keys.find((key) => key.type === 'publishable')?.api_key
    || keys.find((key) => key.name === 'anon')?.api_key
  const serviceKey = keys.find((key) => key.type === 'secret')?.api_key
    || keys.find((key) => key.name === 'service_role')?.api_key
  if (!publishableKey || !serviceKey) throw new Error('Ajutise projekti API võtmeid ei leitud.')

  await writeEnvironment({
    VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SECRET_KEY: serviceKey,
  })
  console.log(JSON.stringify({ created: true, projectRef, projectName }))
}

const deleteProject = async (projectRef = process.env.EPHEMERAL_SUPABASE_PROJECT_REF?.trim()) => {
  if (!projectRef) return false
  if (!/^[a-z]{20}$/.test(projectRef) || projectRef === productionProjectRef) {
    throw new Error('Ajutise projekti kustutamine peatati ebaturvalise projektiviite tõttu.')
  }
  const project = await api(`/projects/${projectRef}`)
  if (!String(project.name ?? '').startsWith(projectPrefix)) {
    throw new Error(`Projekti ${projectRef} nimi ei vasta ajutise E2E projekti prefiksile.`)
  }
  await api(`/projects/${projectRef}`, { method: 'DELETE' })
  console.log(JSON.stringify({ deleted: true, projectRef, projectName: project.name }))
  return true
}

const cleanupStaleProjects = async () => {
  const projects = await api('/projects')
  const cutoff = Date.now() - 3 * 60 * 60 * 1000
  let deleted = 0
  for (const project of projects) {
    if (!String(project.name ?? '').startsWith(projectPrefix)) continue
    if (new Date(project.created_at).getTime() > cutoff) continue
    if (await deleteProject(String(project.ref ?? project.id))) deleted += 1
  }
  console.log(JSON.stringify({ staleProjectsDeleted: deleted }))
}

if (action === 'create') await createProject()
else if (action === 'delete') await deleteProject()
else if (action === 'cleanup') await cleanupStaleProjects()
else throw new Error('Kasutus: node scripts/manage-ephemeral-supabase.mjs create|delete|cleanup')
