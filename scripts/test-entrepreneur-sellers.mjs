import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const databaseUrl = process.argv[2] || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Use a local database.')
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const prerequisites = ['202609300001_merchant_email_policy', '202609300002_disposable_email_domains', '202609300003_account_hygiene']
const sql = `begin;
select to_regclass('public.email_domain_rules') is null as needs_email_migrations \\gset
\\if :needs_email_migrations
${prerequisites.map((name) => read(`../supabase/migrations/${name}.sql`)).join('\n')}
\\endif
select to_regprocedure('public.seller_details_complete(jsonb)') is null as needs_seller_migration \\gset
\\if :needs_seller_migration
${read('../supabase/migrations/202609300004_entrepreneur_sellers.sql')}
\\endif
select to_regclass('public.stripe_oauth_attempts') is null as needs_oauth_migration \\gset
\\if :needs_oauth_migration
${read('../supabase/migrations/202609300005_stripe_oauth.sql')}
\\endif
${read('../supabase/migrations/202609300007_remove_entrepreneur_account_confirmation.sql')}
${read('../supabase/migrations/202609300008_cap_gross_platform_fees.sql')}
${read('../supabase/migrations/202609300012_seller_payout_declaration.sql')}
${read('../supabase/migrations/202609300013_seller_payout_exception.sql')}
${read('./test-entrepreneur-sellers.sql')}
${read('./test-stripe-oauth.sql')}
${read('../supabase/migrations/202609300006_stripe_hosted_onboarding.sql')}
select pg_temp.seller_assert(not has_function_privilege('service_role','public.attach_stripe_oauth_account(text,uuid,text,text,jsonb)','EXECUTE'), 'Old OAuth attachment still enabled');
update public.stores set stripe_connection_type='hosted' where id='78000000-0000-4000-8000-000000000004';
${read('./test-order-invoices.sql').replace('begin;', '').replace(/\nrollback;\s*$/, '')}
${read('./test-platform-fee-rounding.sql').replace('begin;', '').replace(/\nrollback;\s*$/, '')}
rollback;`
const result = spawnSync('psql', [databaseUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
if (result.status !== 0) { console.error(result.stderr || result.error); process.exit(1) }
console.log('Entrepreneur sellers: publication, identity guards, receipts, refunds and fee caps passed (rolled back).')
