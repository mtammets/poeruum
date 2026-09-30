import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const databaseUrl = process.argv[2] || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Test requires a local database.')
const migrations = ['202609300001_merchant_email_policy', '202609300002_disposable_email_domains', '202609300003_account_hygiene']
const migrationSql = migrations.map((name) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')).join('\n')
const fixtures = readFileSync(new URL('./test-account-email-policy.sql', import.meta.url), 'utf8')
const sql = `begin;
select to_regclass('public.email_domain_rules') is null as needs_migrations \\gset
\\if :needs_migrations
${migrationSql}
\\endif
${fixtures}
rollback;`
const result = spawnSync('psql', [databaseUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
if (result.status !== 0) { console.error(result.stderr || result.error); process.exit(1) }
console.log('Account email policy: domain checks, publication, access boundaries, cleanup and signup monitoring passed (rolled back).')
