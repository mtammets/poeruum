import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'
import { createPreviewService, testConfiguration } from './payment-preview/service.mjs'
import { paymentPreviewPlugin } from './payment-preview/plugin.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const environment = {}
for (const name of ['.env', '.env.local']) {
  const path = new URL(`../${name}`, import.meta.url)
  if (fs.existsSync(path)) Object.assign(environment, dotenv.parse(fs.readFileSync(path)))
}
Object.assign(environment, process.env)
const portIndex = process.argv.indexOf('--port')
const port = portIndex < 0 ? 4185 : Number(process.argv[portIndex + 1])
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Eelvaate port peab olema vahemikus 1024–65535.')
const origin = `http://127.0.0.1:${port}`
const configuration = testConfiguration(environment)
let service
const server = await createServer({
  root, configFile: false, envDir: false, envPrefix: 'POERUUM_PREVIEW_EXPOSE_NONE_',
  cacheDir: `node_modules/.vite-payment-preview-${port}`,
  plugins: [paymentPreviewPlugin({ origin, getService: () => service }), react()],
  define: Object.fromEntries(Object.entries({
    VITE_SUPABASE_URL: origin,
    VITE_SUPABASE_PUBLISHABLE_KEY: 'local-payment-preview',
    VITE_STRIPE_PUBLISHABLE_KEY: configuration.publishableKey,
    VITE_TURNSTILE_SITE_KEY: '',
  }).map(([name, value]) => [`import.meta.env.${name}`, JSON.stringify(value)])),
  server: { host: '127.0.0.1', port, strictPort: true, cors: false, open: process.argv.includes('--open') ? '/previews/payments.html' : false },
})
const helperModules = await Promise.all([
  server.ssrLoadModule('/supabase/functions/_shared/stripe-connect-prefill.ts'),
  server.ssrLoadModule('/supabase/functions/_shared/stripe-connect-session.ts'),
  server.ssrLoadModule('/supabase/functions/_shared/stripe-connect-requirements.ts'),
])
service = createPreviewService({ origin, environment, helpers: Object.assign({}, ...helperModules) })
await server.listen()
console.log(`Maksete eelvaade: ${origin}/previews/payments.html`)
console.log(configuration.ready ? 'Stripe’i testvorm on ühendamiseks valmis.' : 'Poeruumi vaated on valmis. Stripe’i vorm vajab STRIPE_TEST_PUBLISHABLE_KEY ja STRIPE_TEST_SECRET_KEY väärtusi failis .env.local.')
let closing = false
async function close() {
  if (closing) return
  closing = true
  await server.close()
  const result = await service.cleanup()
  process.exit(result.failed ? 1 : 0)
}
process.on('SIGINT', close)
