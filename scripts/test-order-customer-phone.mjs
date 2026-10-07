import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const databaseUrl = process.argv[2] || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Phone migration test requires a local database.')
const migration = readFileSync(new URL('../supabase/migrations/202610070004_order_customer_phone.sql', import.meta.url), 'utf8')
const sql = `begin;
-- Exercise the actual upgrade against historical requests, even after db reset.
alter table public.orders drop column if exists customer_phone;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end;
$$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('89000000-0000-4000-8000-000000000001','authenticated','authenticated','phone@example.invalid','{}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug) values
('89000000-0000-4000-8000-000000000002','89000000-0000-4000-8000-000000000001','Phone test','phone-test');
insert into public.stores(id,owner_id,name,slug,deleted_at) values
('89000000-0000-4000-8000-000000000008',null,'Deleted phone test','deleted-phone-test',now());
insert into public.orders(id,store_id,order_number,items,customer_name,customer_email,delivery,product_subtotal,total,payment_status,stripe_mode,reservation_expires_at)
select ('89000000-0000-4000-8000-00000000000'||n)::uuid,
  case when n=7 then '89000000-0000-4000-8000-000000000008'::uuid else '89000000-0000-4000-8000-000000000002'::uuid end,
  'PR-PHONE-'||n,'[]','Phone buyer','buyer@example.invalid','Omniva · Test locker',10,12.9,
  case when n=6 then 'pending' else 'paid' end,'test',now()+interval '35 minutes'
from generate_series(3,7) n;
insert into public.stripe_checkout_attempts(order_id,payload)
select ('89000000-0000-4000-8000-00000000000'||n)::uuid,
  jsonb_build_object('metadata',jsonb_build_object('customer_phone',case when n=4 then '   ' else ' +372 5123 4567 ' end))
from unnest(array[3,4,7]) n;
${migration}
do $$
declare target uuid := '89000000-0000-4000-8000-000000000006'; payload jsonb;
begin
  perform pg_temp.assert_true((select customer_phone='+372 5123 4567' from public.orders where order_number='PR-PHONE-3'),'Historical paid order lost phone');
  perform pg_temp.assert_true((select count(*)=3 from public.orders where order_number in ('PR-PHONE-4','PR-PHONE-5','PR-PHONE-7') and customer_phone is null),'Missing or deleted contact was restored');
  payload:=jsonb_build_object('mode','payment','expires_at',extract(epoch from now()+interval '30 minutes')::bigint,
    'metadata',jsonb_build_object('order_id',target,'store_id','89000000-0000-4000-8000-000000000002','stripe_mode','test','customer_phone',' +372 5555 1234 '));
  perform public.prepare_stripe_checkout(target,payload);
  perform pg_temp.assert_true((select customer_phone='+372 5555 1234' and stripe_checkout_started_at is not null from public.orders where id=target),'New phone was not saved with checkout');
  perform pg_temp.assert_true((public.prepare_stripe_checkout(target,jsonb_set(payload,'{metadata,customer_phone}','"+372 5555 9999"'))).payload=payload,'Retry mutated original payment request');
  perform pg_temp.assert_true((select customer_phone='+372 5555 1234' from public.orders where id=target),'Retry overwrote original contact');
  perform pg_temp.assert_true(not has_table_privilege('authenticated','public.stripe_checkout_attempts','select'),'Private checkout payload became merchant-readable');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.prepare_stripe_checkout(uuid,jsonb)','execute')
    and not has_function_privilege('anon','public.prepare_stripe_checkout(uuid,jsonb)','execute')
    and has_function_privilege('service_role','public.prepare_stripe_checkout(uuid,jsonb)','execute'),'Checkout privileges changed');
end; $$;
-- Account deletion must clear the new shipping field along with existing contacts.
delete from auth.users where id='89000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select count(*)=4 from public.orders where store_id='89000000-0000-4000-8000-000000000002'
  and customer_name='Kustutatud klient' and customer_phone is null),'Deleted account retained phone numbers');
rollback;`
const result = spawnSync(process.env.PSQL_BINARY || 'psql', [databaseUrl, '-Xq', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })
if (result.error) throw result.error
if (result.status !== 0) throw new Error(result.stderr || 'Order phone migration test failed.')
console.log('Order phone backfill, new checkout, immutable retry and account deletion passed; all fixtures and schema changes rolled back.')
