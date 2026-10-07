\set ON_ERROR_STOP on
begin;
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('98100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'authenticated','authenticated','store-analytics-' || n || '@example.invalid','{}','{}',now(),now() from generate_series(1,2) n;
insert into public.stores (id,owner_id,name,slug,is_published,created_at) values
  ('98200000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000001','Analytics A','analytics-a',true,now()-interval '200 days'),
  ('98200000-0000-4000-8000-000000000002','98100000-0000-4000-8000-000000000002','Analytics B','analytics-b',true,now()-interval '200 days');
insert into public.products (id,store_id,name,image_url,price) values
  ('analytics-cup','98200000-0000-4000-8000-000000000001','Cup','',25),
  ('analytics-other','98200000-0000-4000-8000-000000000002','Other','',50);
insert into public.custom_domains (store_id,hostname,status) values ('98200000-0000-4000-8000-000000000001','analytics.example.com','active');

create function pg_temp.analytics_event(kind text, product text default '') returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'session_id','98300000-0000-4000-8000-000000000001',
    'event_name',kind,'product_id',product,'source','Kaubamaja'));
$$;
set local role service_role;
do $$
declare sid uuid := '98200000-0000-4000-8000-000000000001'; payload jsonb;
begin
  payload := pg_temp.analytics_event('visit');
  if public.record_store_analytics(sid,'analytics-a.poeruum.ee',payload) <> 1 then raise exception 'NO_VISIT'; end if;
  if public.record_store_analytics(sid,'analytics-a.poeruum.ee',payload) <> 0 then raise exception 'RETRY_DUPLICATE'; end if;
  if public.record_store_analytics(sid,'analytics-a.poeruum.ee',pg_temp.analytics_event('visit')) <> 0 then raise exception 'SEMANTIC_DUPLICATE'; end if;
  if public.record_store_analytics(sid,'analytics.example.com',pg_temp.analytics_event('product_view','analytics-cup')) <> 1 then raise exception 'CUSTOM_DOMAIN_REJECTED'; end if;
  if public.record_store_analytics(sid,'analytics-a.poeruum.ee',pg_temp.analytics_event('product_view','analytics-other')) <> 0 then raise exception 'CROSS_STORE_PRODUCT'; end if;
  begin perform public.record_store_analytics(sid,'analytics-b.poeruum.ee',payload); raise exception 'WRONG_ORIGIN_ACCEPTED'; exception when insufficient_privilege then null; end;
  begin perform public.record_store_analytics(sid,'analytics.example.com.attacker.test',payload); raise exception 'SPOOF_ORIGIN_ACCEPTED'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Include unpaid, test, partial/full refund and another shop to catch leakage.
insert into public.orders (store_id,order_number,items,customer_name,customer_email,delivery,product_subtotal,total,payment_status,stripe_mode,stripe_payment_intent_id,stripe_refunded_amount_cents,invoice_paid_at)
values
 ('98200000-0000-4000-8000-000000000001','analytics-paid','[]','Test','test@example.invalid','pickup',100,100,'paid','live','pi_analytics_paid',2000,now()),
 ('98200000-0000-4000-8000-000000000001','analytics-refunded','[]','Test','test@example.invalid','pickup',25,25,'refunded','live','pi_analytics_refunded',2500,now()),
 ('98200000-0000-4000-8000-000000000001','analytics-test','[]','Test','test@example.invalid','pickup',500,500,'paid','test','pi_analytics_test',0,now()),
 ('98200000-0000-4000-8000-000000000001','analytics-pending','[]','Test','test@example.invalid','pickup',500,500,'pending','live',null,0,null),
 ('98200000-0000-4000-8000-000000000002','analytics-other','[]','Test','test@example.invalid','pickup',900,900,'paid','live','pi_analytics_other',0,now());

set local role anon;
do $$ begin
  begin perform public.merchant_store_analytics('98200000-0000-4000-8000-000000000001',7); raise exception 'ANON_READ'; exception when insufficient_privilege then null; end;
  begin perform * from public.store_analytics_events; raise exception 'ANON_RAW_READ'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"98100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
declare report jsonb;
begin
  report := public.merchant_store_analytics('98200000-0000-4000-8000-000000000001',7);
  if (report#>>'{current,visits}')::integer <> 1 then raise exception 'BAD_VISITS %', report; end if;
  if (report#>>'{current,orders}')::integer <> 1 or (report#>>'{current,sales}')::numeric <> 80 then raise exception 'BAD_PAYMENTS %',report; end if;
  if (report#>>'{sources,0,visits}')::integer <> 1 or jsonb_array_length(report->'products') <> 1 then raise exception 'BAD_BREAKDOWNS'; end if;
  if (report->>'comparison_available')::boolean then raise exception 'INVENTED_HISTORY'; end if;
  if report#>'{daily,0,visits}' <> 'null'::jsonb then raise exception 'UNKNOWN_HISTORY_AS_ZERO'; end if;
  if jsonb_array_length(report->'daily') <> 7 then raise exception 'BAD_DAYS'; end if;
  begin perform public.merchant_store_analytics('98200000-0000-4000-8000-000000000002',7); raise exception 'OTHER_STORE_READ'; exception when insufficient_privilege then null; end;
  begin perform public.merchant_store_analytics('98200000-0000-4000-8000-000000000001',10000); raise exception 'UNBOUNDED_RANGE'; exception when invalid_parameter_value then null; end;
  begin perform * from public.store_analytics_events; raise exception 'RAW_EVENT_READ'; exception when insufficient_privilege then null; end;
  begin perform public.record_store_analytics('98200000-0000-4000-8000-000000000001','analytics-a.poeruum.ee',pg_temp.analytics_event('visit')); raise exception 'PUBLIC_INGEST'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.store_analytics_settings set started_at=now()-interval '200 days' where id;
insert into public.store_analytics_events(id,store_id,session_id,event_name,source,occurred_at) values
  (gen_random_uuid(),'98200000-0000-4000-8000-000000000001',gen_random_uuid(),'visit','Google',(((now() at time zone 'Europe/Tallinn')::date - 7)::timestamp at time zone 'Europe/Tallinn')),
  (gen_random_uuid(),'98200000-0000-4000-8000-000000000001',gen_random_uuid(),'visit','Google',(((now() at time zone 'Europe/Tallinn')::date - 1)::timestamp at time zone 'Europe/Tallinn'));
set local role authenticated;
do $$ declare report jsonb; begin
  report := public.merchant_store_analytics('98200000-0000-4000-8000-000000000001',7);
  if not (report->>'comparison_available')::boolean then raise exception 'MISSING_HISTORY'; end if;
  if (report#>>'{previous,visits}')::integer <> 1 or (report#>>'{current,visits}')::integer <> 2 then raise exception 'BAD_PERIOD_BOUNDARY %',report; end if;
  if (report#>>'{daily,5,visits}')::integer <> 1 then raise exception 'WRONG_TALLINN_DAY'; end if;
  report := public.merchant_store_analytics('98200000-0000-4000-8000-000000000001',30);
  if jsonb_array_length(report->'daily') <> 30 then raise exception 'BAD_MONTH'; end if;
end $$;
reset role;
rollback;
