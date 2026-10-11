import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const databaseUrl = process.argv[2] || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Use a local database.')
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const installed = spawnSync('psql', [databaseUrl, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', "select to_regclass('public.store_withdrawals') is not null"], { encoding: 'utf8' })
if (installed.status !== 0) throw new Error(installed.stderr || 'Cannot inspect local database.')
const migration = installed.stdout.trim() === 't' ? '' : read('../supabase/migrations/202610110002_store_withdrawals.sql')
const closedStoreTest = read('./test-closed-storefront.sql').replace(/^begin;\s*$/gmi, '').replace(/^rollback;\s*$/gmi, '')
const result = spawnSync('psql', [databaseUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], {
  input: `begin;\n${migration}\n${read('./test-withdrawals.sql')}\n${closedStoreTest}\nrollback;`,
  encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
})
if (result.status !== 0) { console.error(result.stderr || result.error); process.exit(1) }
console.log('Withdrawals: RLS, immutable submission, idempotency, unmatched references, queue leases, delivery reconciliation and unchanged payments passed (rolled back).')
