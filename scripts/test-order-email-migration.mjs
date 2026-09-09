import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const databaseUrl = process.argv[2] || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!['127.0.0.1','localhost','[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Migration test requires a local database.')
const migration = readFileSync(new URL('../supabase/migrations/202609090003_durable_order_emails.sql', import.meta.url), 'utf8')
const start = migration.indexOf('insert into public.order_email_jobs(order_id, kind, stripe_mode, status, accepted_at, legacy_import, last_error)')
const end = migration.indexOf('on conflict (order_id, kind) do nothing;', start)
if (start < 0 || end < 0) throw new Error('Email migration backfill statement was not found.')
const backfill = migration.slice(start, end + 'on conflict (order_id, kind) do nothing;'.length)
const schedule = migration.slice(migration.lastIndexOf('do $$'))
// Run the actual migration statements against historical fixtures, inside a
// rolled-back transaction. The cron schedule never becomes visible or runs.
const sql = `begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('76000000-0000-4000-8000-000000000001','authenticated','authenticated','migration@example.invalid','{}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug,settings) values
('76000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000001','Enabled','email-migration-enabled','{}'),
('76000000-0000-4000-8000-000000000003','76000000-0000-4000-8000-000000000001','Disabled','email-migration-disabled','{"customerConfirmations":false,"sellerNotifications":false}');
insert into public.orders(id,store_id,order_number,items,customer_name,customer_email,delivery,
product_subtotal,total,payment_status,stripe_mode,stripe_payment_intent_id,customer_confirmation_sent_at,seller_notification_sent_at)
select ('76000000-0000-4000-8000-00000000000' || n)::uuid,
case when n = 6 then '76000000-0000-4000-8000-000000000003'::uuid else '76000000-0000-4000-8000-000000000002'::uuid end,
'PR-MIGRATION-' || n,'[]','Test','customer@example.invalid','Pickup',10,10,'paid','test','pi_migration_' || n,
case when n = 4 then now() end, case when n = 4 then now() end from generate_series(4,6) n;
delete from public.order_email_jobs where order_id::text like '76000000-%';
${backfill}
do $$ begin
  if (select count(*) from public.order_email_jobs where order_id::text like '76000000-%' and status = 'accepted' and legacy_import) <> 2
    or (select count(*) from public.order_email_jobs where order_id::text like '76000000-%' and status = 'needs_review' and legacy_import) <> 2
    or (select count(*) from public.order_email_jobs where order_id::text like '76000000-%' and status = 'skipped' and legacy_import) <> 2 then
    raise exception 'Historical email backfill has unsafe outcomes';
  end if;
  if exists(select 1 from public.claim_order_email_job('test','76000000-0000-4000-8000-000000000005')) then
    raise exception 'Ambiguous historical email was automatically resent';
  end if;
end; $$;
select vault.create_secret('https://example.invalid/functions/v1/onboarding-reminders','onboarding_reminders_url');
select vault.create_secret('local-test-value','onboarding_cron_secret');
${schedule}
do $$ begin
  if not exists(select 1 from cron.job where jobname = 'poeruum-order-emails' and active
    and schedule = '* * * * *' and command like '%/order-emails%' and command like '%120000%') then
    raise exception 'Order email cron was not configured';
  end if;
end; $$;
rollback;`
const result = spawnSync(process.env.PSQL_BINARY || 'psql', [databaseUrl,'-q','-v','ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })
if (result.error) throw result.error
if (result.status !== 0) throw new Error(result.stderr || 'Migration test failed.')
console.log('Historical email backfill and cron configuration passed; all fixtures rolled back.')
