\set ON_ERROR_STOP on
begin;
\ir ../supabase/migrations/202610010002_admin_user_overview.sql
\ir ../supabase/migrations/202610010003_admin_user_insights.sql
create function pg_temp.verify(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end; $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','overview'||n||'@example.invalid',
  case when n=0 then '{"role":"admin"}'::jsonb else '{}'::jsonb end,'{}',now()-interval '50 days',now()
from generate_series(0,4) n;
insert into public.stores(id,owner_id,name,slug,is_published,payment_provider,payment_status,stripe_account_id,stripe_account_mode,stripe_account_charges_enabled,stripe_account_payouts_enabled,settings)
select ('82000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'Overview '||n,'overview-test-'||n,true,'stripe','connected','acct_overview_'||n,case when n=2 then 'test' else 'live' end,true,true,
  '{"businessName":"Test","registryCode":"12345678","businessAddress":"Test 1","contactEmail":"test@example.invalid"}'
from generate_series(1,3) n;
insert into public.store_payment_checks(store_id,account_id,stripe_mode,identity,stripe_ready)
select id,stripe_account_id,stripe_account_mode,public.seller_identity_key(settings),true from public.stores where id in ('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002');
insert into public.orders(store_id,order_number,items,customer_name,customer_email,delivery,product_subtotal,total,payment_status,stripe_mode,stripe_payment_intent_id,stripe_refunded_amount_cents,created_at)
select '82000000-0000-4000-8000-000000000001','OV-'||n,'[]','Test','buyer@example.invalid','Pickup',total,total,status,mode,
  case when n=8 then null else 'pi_overview_'||n end,refund,now()-age
from (values
  (1,100,'paid','live',0,interval '1 day'),
  (2,50,'paid','live',1500,interval '2 days'),
  (3,80,'refunded','live',8000,interval '12 hours'),
  (4,999,'pending','live',0,interval '1 hour'),
  (5,999,'failed','live',0,interval '2 hours'),
  (6,777,'paid','test',0,interval '3 hours'),
  (7,42,'paid','live',0,interval '35 days'),
  (8,888,'paid','live',0,interval '4 hours')
) f(n,total,status,mode,refund,age);
insert into public.support_conversations(id,user_id,subject,status,last_message_at)
values('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','Reply needed','open',now()-interval '2 days'),
('83000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','Waiting on seller','waiting_user',now()),
('83000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','Resolved','resolved',now());
insert into public.products(id,store_id,name,image_url,created_at) values
('insight-old','82000000-0000-4000-8000-000000000001','Old','test',now()-interval '50 days'),
('insight-new','82000000-0000-4000-8000-000000000001','New','test',now()-interval '1 day');
insert into public.orders(store_id,order_number,items,customer_name,customer_email,delivery,product_subtotal,total,payment_status,stripe_mode,stripe_payment_intent_id,created_at)
values ('82000000-0000-4000-8000-000000000003','BOUNDARY-IN','[]','Test','test@example.invalid','Pickup',7,7,'paid','live','pi_boundary_in',now()-interval '30 days'),
('82000000-0000-4000-8000-000000000003','BOUNDARY-OUT','[]','Test','test@example.invalid','Pickup',999,999,'paid','live','pi_boundary_out',now()-interval '30 days 1 second');
select set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
set local role authenticated;
do $$ declare result jsonb; row jsonb;
begin
  result:=public.admin_user_overview();
  select value into row from jsonb_array_elements(result) where value->>'user_id'='81000000-0000-4000-8000-000000000001';
  perform pg_temp.verify((row->>'paid_orders_30d')::int=2,'Pending, failed, test, refunded, unconfirmed or old orders polluted the 30-day count');
  perform pg_temp.verify((row->>'net_sales_30d_cents')::int=13500,'Net receipts did not subtract partial/full refunds or mixed test/pending payments');
  perform pg_temp.verify((row->>'paid_orders_total')::int=3,'Lifetime count did not include the older paid order');
  perform pg_temp.verify((row->>'last_paid_order_at')::timestamptz=now()-interval '1 day','Latest order uses system updates or unpaid orders');
  perform pg_temp.verify(row->>'payment_state'='active','Verified live payments must be active');
  perform pg_temp.verify((row->>'awaiting_admin_count')::int=1 and (row->>'waiting_user_count')::int=1,'Waiting-user conversations became tasks for admin');
  perform pg_temp.verify(row->>'awaiting_admin_conversation_id'='83000000-0000-4000-8000-000000000001','Reply action opens wrong conversation');
  perform pg_temp.verify(not exists(select from jsonb_array_elements(result) where value->>'user_id'='81000000-0000-4000-8000-000000000000'),'Admin is included among merchants');
  select value into row from jsonb_array_elements(result) where value->>'user_id'='81000000-0000-4000-8000-000000000002';
  perform pg_temp.verify(row->>'payment_state'='test','Test account presented as live');
  perform pg_temp.verify((row->>'paid_orders_30d')::int=0 and (row->>'net_sales_30d_cents')::int=0,'Empty history must have actual zeros');
  select value into row from jsonb_array_elements(result) where value->>'user_id'='81000000-0000-4000-8000-000000000003';
  perform pg_temp.verify(row->>'payment_state'='unknown','Missing verification invented a healthy payment state');
end; $$;
do $$ declare detail jsonb; total bigint; overview jsonb;
begin
  detail:=public.admin_user_insights('81000000-0000-4000-8000-000000000001');
  select value into overview from jsonb_array_elements(public.admin_user_overview()) where value->>'user_id'=detail->>'user_id';
  select sum((value->>'net_cents')::bigint) into total from jsonb_array_elements(detail->'sales_days');
  perform pg_temp.verify(total=(overview->>'net_sales_30d_cents')::bigint and total=13500,'Chart does not match actual net sales');
  perform pg_temp.verify(detail->'order_states'='{"paid":2,"pending":1,"failed":1,"refunded":1}'::jsonb,'Order states include test or unconfirmed payments');
  perform pg_temp.verify((detail->>'products_added_30d')::int=1 and (detail->>'first_product_at')::timestamptz=now()-interval '50 days','Product milestones are not actual creation times');
  perform pg_temp.verify((detail->>'support_resolved')::int=1,'Resolved support count wrong');
  detail:=public.admin_user_insights('81000000-0000-4000-8000-000000000003');
  perform pg_temp.verify((select sum((value->>'net_cents')::bigint)=700 from jsonb_array_elements(detail->'sales_days')),'Rolling window lost boundary or included older orders');
  detail:=public.admin_user_insights('81000000-0000-4000-8000-000000000004');
  perform pg_temp.verify(detail->'payments'='null'::jsonb and (select sum((value->>'net_cents')::bigint)=0 from jsonb_array_elements(detail->'sales_days')),'No-store user needs empty genuine history');
  begin perform public.admin_user_insights('81000000-0000-4000-8000-000000000099'); raise exception 'Missing user did not fail'; exception when no_data_found then null; end;
end; $$;
reset role;
do $$ declare previous_revision bigint;
begin
  select revision into previous_revision from public.admin_dashboard_refresh where id;
  update public.store_payment_checks set identity_error='Identity does not match' where store_id='82000000-0000-4000-8000-000000000001';
  perform pg_temp.verify((select revision>previous_revision from public.admin_dashboard_refresh where id),'Payment checks did not refresh the live dashboard');
end; $$;
set local role authenticated;
select pg_temp.verify((select value->>'payment_state'='restricted' from jsonb_array_elements(public.admin_user_overview()) where value->>'user_id'='81000000-0000-4000-8000-000000000001'),'Identity issue does not block payments');
select set_config('request.jwt.claims','{"app_metadata":{}}',true);
do $$ begin
  begin perform public.admin_user_overview(); raise exception 'Non-admin accessed merchant metrics';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_user_insights('81000000-0000-4000-8000-000000000001'); raise exception 'Non-admin accessed drilldown'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
select pg_temp.verify(not has_function_privilege('anon','public.admin_user_overview()','execute'),'Anonymous access permitted');
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","app_metadata":{}}',true);
set local role authenticated;
select public.touch_user_presence_view('84000000-0000-4000-8000-000000000001','payments');
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000002","app_metadata":{}}',true);
select public.touch_user_presence_view('84000000-0000-4000-8000-000000000001','business');
do $$ begin
  begin perform public.touch_user_presence_view('84000000-0000-4000-8000-000000000002','arbitrary private content'); raise exception 'Arbitrary content stored in presence';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_user_presence(); raise exception 'Merchant read presence';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
insert into public.user_presence_sessions(session_id,user_id,last_seen_at,current_view)
values('84000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003',now()-interval '96 seconds','storefront');
select set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select pg_temp.verify(exists(select from public.admin_user_presence() where user_id='81000000-0000-4000-8000-000000000001' and current_view='payments'),'Another user overwrote the session view');
select pg_temp.verify(not exists(select from public.admin_user_presence() where user_id='81000000-0000-4000-8000-000000000003'),'Expired session remains online');
reset role;
select pg_temp.verify(not has_function_privilege('anon','public.touch_user_presence_view(uuid,text)','execute') and not has_function_privilege('anon','public.admin_user_presence()','execute'),'Anonymous presence access permitted');
select pg_temp.verify(not has_function_privilege('anon','public.admin_user_insights(uuid)','execute'),'Anonymous drilldown access permitted');
rollback;
