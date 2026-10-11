import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const databaseUrl = process.argv[2] || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Use a local database.')
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const result = spawnSync('psql', [databaseUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], {
  input: `begin;\n${read('../supabase/migrations/202610110001_guard_seller_settings.sql')}\n${read('./test-seller-settings.sql')}\nrollback;`,
  encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
})
if (result.status !== 0) { console.error(result.stderr || result.error); process.exit(1) }
console.log('Seller settings: owner/RPC permissions, identity lock, validation, atomic verification and stale updates passed (rolled back).')
