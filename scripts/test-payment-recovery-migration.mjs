import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const databaseUrl = process.argv[2] || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Migration test requires a local database.')
const migration = readFileSync(new URL('../supabase/migrations/202609090005_payment_recovery.sql', import.meta.url), 'utf8')
const start = migration.indexOf('do $$\ndeclare reminder_url text;')
const end = migration.indexOf('\n$$;', start)
if (start < 0 || end < 0) throw new Error('Recovery schedule not found.')
const schedule = migration.slice(start, end + '\n$$;'.length)
const marker = migration.match(/update public.orders set stripe_checkout_started_at = created_at[\s\S]*?;/)?.[0]
const backfill = migration.match(/insert into public.order_payment_recovery\(order_id,stripe_mode\)\nselect[\s\S]*?;/)?.[0]
if (!marker || !backfill) throw new Error('Recovery backfill not found.')
const sql = `begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('79000000-0000-4000-8000-000000000001','authenticated','authenticated','recovery@example.invalid','{}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug) values('79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000001','Recovery','recovery-test');
insert into public.orders(id,store_id,order_number,items,customer_name,customer_email,delivery,product_subtotal,total,payment_status,stripe_mode)
select ('79000000-0000-4000-8000-00000000000'||n)::uuid,'79000000-0000-4000-8000-000000000002','PR-HISTORY-'||n,
'[]','Test','test@example.invalid','Pickup',10,10,case n when 3 then 'pending' when 4 then 'failed' else 'paid' end,'test' from generate_series(3,5) n;
delete from public.order_payment_recovery where order_id::text like '79000000-%';
${marker}
${backfill}
do $$ begin
  if (select count(*) from public.order_payment_recovery where order_id::text like '79000000-%')<>3 then raise exception 'Historical recovery jobs missing'; end if;
  if (select stripe_checkout_started_at from public.orders where id='79000000-0000-4000-8000-000000000003') is null then raise exception 'Legacy uncertain checkout unprotected'; end if;
end; $$;
select vault.create_secret('https://example.invalid/functions/v1/onboarding-reminders','onboarding_reminders_url');
select vault.create_secret('local-test-value','onboarding_cron_secret');
select cron.schedule('old-reservation-reaper','*/5 * * * *',$old$ select '/stripe-reservation-reaper'; $old$);
${schedule}
do $$ begin
  if not exists(select 1 from cron.job where jobname='poeruum-payment-recovery' and active and schedule='* * * * *'
    and command like '%/stripe-reservation-reaper%' and command like '%120000%') then raise exception 'Recovery cron missing'; end if;
  if exists(select 1 from cron.job where jobname='old-reservation-reaper') then raise exception 'Duplicate old schedule retained'; end if;
end; $$;
rollback;`
const result = spawnSync(process.env.PSQL_BINARY || 'psql', [databaseUrl, '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })
if (result.error) throw result.error
if (result.status !== 0) throw new Error(result.stderr || 'Migration test failed.')
console.log('Historical recovery backfill and cron replacement passed; all fixtures rolled back.')
