import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const databaseUrl = args.find((argument) => !argument.startsWith('--')) || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Migration test requires a local database.')
const migration = readFileSync(new URL('../supabase/migrations/202609230001_email_source_isolation.sql', import.meta.url), 'utf8')
const orderMigration = readFileSync(new URL('../supabase/migrations/202609090003_durable_order_emails.sql', import.meta.url), 'utf8')

// Apply the real migrations and historical fixtures in one transaction, then
// roll everything back. The optional prerequisite supports older local DBs;
// --install-first exercises the CI path where this migration is already present.
const sql = String.raw`begin;
select to_regclass('public.order_email_jobs') is null as needs_order_migration \gset
\if :needs_order_migration
${orderMigration}
\endif
select exists (select 1 from information_schema.columns where table_schema = 'public'
  and table_name = 'email_deliveries' and column_name = 'source_application') as isolation_installed \gset
${args.includes('--install-first') ? String.raw`\if :isolation_installed
\else
${migration}
\endif` : ''}
-- Restore the historical schema for these fixtures even after a full CI DB
-- migration. This reset, including existing provenance, is always rolled back.
drop trigger if exists email_deliveries_attribute_local_source on public.email_deliveries;
drop function if exists public.attribute_local_email_delivery();
alter table public.email_deliveries
  drop column if exists sender_email,
  drop column if exists source_application;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end;
$$;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('81000000-0000-4000-8000-000000000001','authenticated','authenticated','isolation@example.invalid','{}','{}',now(),now()),
('81000000-0000-4000-8000-000000000002','authenticated','authenticated','external-only@example.invalid','{}','{}',now(),now()),
('81000000-0000-4000-8000-000000000003','authenticated','authenticated','unknown-only@example.invalid','{}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug,settings)
values ('81000000-0000-4000-8000-000000000004','81000000-0000-4000-8000-000000000001','Isolation test','email-isolation-test','{}');
insert into public.orders(id,store_id,order_number,items,customer_name,customer_email,delivery,product_subtotal,total,payment_status,stripe_mode)
values ('81000000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000004','PR-ISOLATION','[]','Test','isolation@example.invalid','Pickup',10,10,'pending','test');
insert into public.order_email_jobs(id,order_id,kind,stripe_mode,status,resend_email_id,payload)
values ('81000000-0000-4000-8000-000000000006','81000000-0000-4000-8000-000000000005','customer','test','accepted','isolation-legacy-order',
'{"from":"Store via Poeruum <TEAVITUSED@send.poeruum.ee>","to":["isolation@example.invalid"],"subject":"Local order"}');
insert into public.sales_leads(id,company_name,source_url,source_dataset,contact_email,status,resend_email_id,send_claim_id)
values ('81000000-0000-4000-8000-000000000007','Legacy lead','https://example.invalid','legacy','legacy-lead@example.invalid','sent','isolation-legacy-lead',null),
('81000000-0000-4000-8000-000000000008','Future lead','https://example.invalid','legacy','future-lead@example.invalid','sending',null,'81000000-0000-4000-8000-000000000009');
insert into public.email_deliveries(resend_email_id,recipient_email,subject,email_type,status,sent_at,status_updated_at)
values ('isolation-legacy-order','ISOLATION@example.invalid','Local order',null,'delivered',now()-interval '3 days',now()),
('isolation-legacy-lead','legacy-lead@example.invalid','Local lead',null,'delivered',now()-interval '2 days',now()),
('isolation-legacy-unknown','isolation@example.invalid','Unverified subject','support_reply','delivered',now(),now()),
('isolation-only-unknown','unknown-only@example.invalid','Unknown','order_seller_notification','delivered',now(),now());

${migration}

select pg_temp.assert_true((select source_application = 'poeruum' and sender_email = 'teavitused@send.poeruum.ee'
  from public.email_deliveries where resend_email_id = 'isolation-legacy-order'), 'Historical local order ownership or sender was lost');
select pg_temp.assert_true((select source_application = 'poeruum' and sender_email is null
  from public.email_deliveries where resend_email_id = 'isolation-legacy-lead'), 'Historical local lead ownership was lost');
select pg_temp.assert_true((select count(*) = 2 from public.email_deliveries
  where resend_email_id in ('isolation-legacy-unknown','isolation-only-unknown') and source_application is null), 'Unknown legacy messages were trusted by type');

-- Trusted local send-completion SQL omits the newly introduced provenance.
select public.complete_sales_lead_send('81000000-0000-4000-8000-000000000008','81000000-0000-4000-8000-000000000009',
  'isolation-future-lead','Local outreach','Body');
select pg_temp.assert_true((select source_application = 'poeruum' from public.email_deliveries
  where resend_email_id = 'isolation-future-lead'), 'A local lead send lost provenance');
insert into public.order_email_jobs(id,order_id,kind,stripe_mode,status,lease_token,lease_expires_at,payload)
values ('81000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000005','seller','test','processing',
  '81000000-0000-4000-8000-000000000011',now()+interval '1 hour',
  '{"from":"Poeruum <teavitused@send.poeruum.ee>","to":["seller@example.invalid"],"subject":"New order"}');
select public.finish_order_email_job('81000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000011','accepted','isolation-future-order');
select pg_temp.assert_true((select source_application = 'poeruum' and sender_email = 'teavitused@send.poeruum.ee'
  from public.email_deliveries where resend_email_id = 'isolation-future-order'), 'A local order send lost provenance');

insert into public.email_deliveries(resend_email_id,recipient_email,subject,status,sent_at,status_updated_at,sender_email,source_application)
values ('isolation-foreign','isolation@example.invalid','Other app','delivered',now()+interval '1 hour',now(),'other@example.invalid','external'),
('isolation-only-foreign','external-only@example.invalid','Other app','delivered',now(),now(),'other@example.invalid','external'),
('isolation-auth','isolation@example.invalid','Account confirmation','delivered',now()-interval '1 day',now(),'teavitused@send.poeruum.ee','poeruum');

-- An explicit external classification survives even a coinciding local ID.
update public.email_deliveries set source_application = 'external', sender_email = 'other@example.invalid'
where resend_email_id = 'isolation-legacy-order';
update public.email_deliveries set status = 'sent' where resend_email_id = 'isolation-legacy-order';
select pg_temp.assert_true((select source_application = 'external' and sender_email = 'other@example.invalid'
  from public.email_deliveries where resend_email_id = 'isolation-legacy-order'), 'A status update overwrote explicit external ownership');

-- Update-time correlation supports webhook-before-send-completion ordering.
insert into public.email_deliveries(resend_email_id,recipient_email,subject,status,sent_at,status_updated_at)
values ('isolation-late-correlation','late@example.invalid','Late correlation','sent',now(),now());
update public.sales_leads set resend_email_id = 'isolation-late-correlation' where id = '81000000-0000-4000-8000-000000000007';
update public.email_deliveries set status = 'delivered' where resend_email_id = 'isolation-late-correlation';
select pg_temp.assert_true((select source_application = 'poeruum' from public.email_deliveries
  where resend_email_id = 'isolation-late-correlation'), 'A later local correlation was not applied');

do $$ begin
  begin
    update public.email_deliveries set source_application = 'unrelated-app' where resend_email_id = 'isolation-foreign';
    raise exception 'Invalid source value was accepted';
  exception when check_violation then null;
  end;
  perform pg_temp.assert_true(not has_function_privilege('anon','public.admin_latest_email_deliveries()','execute'), 'Anonymous access was granted');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.attribute_local_email_delivery()','execute'), 'Internal trigger function was exposed');
end; $$;

set local request.jwt.claims = '{"role":"authenticated","app_metadata":{"role":"admin"}}';
set local role authenticated;
select pg_temp.assert_true((select count(*) = 1 and min(resend_email_id) = 'isolation-auth'
  from public.admin_latest_email_deliveries() where user_id::text like '81000000-%'),
  'The admin list exposed unknown/external messages or filtered after selecting the latest');
reset role;
set local request.jwt.claims = '{"role":"authenticated","app_metadata":{}}';
set local role authenticated;
do $$ begin
  begin
    perform public.admin_latest_email_deliveries();
    raise exception 'A non-admin read email summaries';
  exception when insufficient_privilege then null;
  end;
end; $$;
reset role;
rollback;`

const result = spawnSync(process.env.PSQL_BINARY || 'psql', [databaseUrl, '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })
if (result.error) throw new Error(result.stderr || result.error.message)
if (result.status !== 0) throw new Error(result.stderr || 'Email isolation migration test failed.')
console.log('Email source backfill, local send attribution, admin isolation and access checks passed; all changes rolled back.')
