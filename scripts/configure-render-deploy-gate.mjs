import process from 'node:process'
import { config } from 'dotenv'

config({ path: '.env', quiet: true })

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const action = process.argv[2] ?? 'verify'
if (!['apply', 'verify'].includes(action)) {
  throw new Error('Kasuta käsku kujul: node scripts/configure-render-deploy-gate.mjs [apply|verify]')
}

const endpoint = `https://api.render.com/v1/services/${encodeURIComponent(required('RENDER_SERVICE_ID'))}`
const request = async (method, body) => {
  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${required('RENDER_API_KEY')}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`Renderi deploy-värava päring ebaõnnestus (${response.status}): ${JSON.stringify(result)}`)
  }
  return result
}

if (action === 'apply') {
  await request('PATCH', { autoDeployTrigger: 'checksPass' })
}

const service = await request('GET')
if (service.autoDeployTrigger !== 'checksPass') {
  throw new Error(`Renderi auto-deploy väärtus on ${service.autoDeployTrigger ?? 'puudu'}, oodatud checksPass.`)
}

console.log(action === 'apply'
  ? 'Render deploy’b nüüd ainult pärast edukat CI kontrolli.'
  : 'Renderi deploy-värav ootab edukat CI kontrolli.')
