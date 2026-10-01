import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const databaseUrl = process.argv[2] || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Use a local database')
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const sql = `begin;
select to_regclass('public.platform_fee_documents') is null as needs_platform_billing_migration \\gset
\\if :needs_platform_billing_migration
${read('../supabase/migrations/202610010001_platform_fee_invoices.sql')}
\\endif
${read('./test-platform-billing.sql')}
${read('./test-platform-fee-rounding.sql').replace('begin;', '').replace(/\nrollback;\s*$/, '')}
rollback;`
const result = spawnSync('psql', [databaseUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 4*1024*1024 })
if (result.status !== 0) { console.error(result.stderr || result.error); process.exit(1) }
console.log('Platform fee invoices: identity, VAT boundary, numbering, credits, immutability, permissions, worker leases and rounding passed (rolled back).')
