\set ON_ERROR_STOP on
load 'safeupdate';
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('95000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'directory-stats@example.invalid', '{}', '{}', now(), now());
insert into public.stores (id, owner_id, name, slug, is_published) values
  ('96000000-0000-4000-8000-000000000011', '95000000-0000-4000-8000-000000000009', 'Stats first', 'stats-first', true),
  ('96000000-0000-4000-8000-000000000012', '95000000-0000-4000-8000-000000000009', 'Stats second', 'stats-second', true),
  ('96000000-0000-4000-8000-000000000013', '95000000-0000-4000-8000-000000000009', 'Stats private', 'stats-private', false);
insert into public.products (id, store_id, name, image_url, price, stock, search_visible) values
  ('stats-product', '96000000-0000-4000-8000-000000000011', 'Stats cup', '', 20, 1, true);

create function pg_temp.event_payload(kind text, sid uuid, store uuid default null, product text default null, placement text default null, item_position integer default null, results integer default null)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'session_id', sid, 'event_name', kind,
    'store_id', store, 'product_id', product, 'placement', placement, 'position', item_position, 'result_count', results,
    'referrer_host', 'google.com', 'device_type', 'mobile'));
$$;

set local role anon;
do $$ begin
  begin perform public.record_directory_analytics('[]'); raise exception 'ANON_INGEST'; exception when insufficient_privilege then null; end;
  begin perform public.admin_directory_analytics(7); raise exception 'ANON_REPORT'; exception when insufficient_privilege then null; end;
  begin perform * from public.directory_analytics_events; raise exception 'ANON_RAW_READ'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"user_metadata":{"role":"admin"},"app_metadata":{}}', true);
set local role authenticated;
do $$ begin
  begin perform public.admin_directory_analytics(7); raise exception 'MERCHANT_REPORT'; exception when insufficient_privilege then null; end;
  begin perform public.record_directory_analytics('[]'); raise exception 'MERCHANT_INGEST'; exception when insufficient_privilege then null; end;
  begin perform public.directory_analytics_metrics(now(), now(), null); raise exception 'MERCHANT_HELPER'; exception when insufficient_privilege then null; end;
  begin perform * from public.directory_analytics_events; raise exception 'MERCHANT_RAW_READ'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$
declare
  sid uuid := '97000000-0000-4000-8000-000000000011';
  store uuid := '96000000-0000-4000-8000-000000000011';
  payload jsonb;
begin
  perform public.record_directory_analytics(pg_temp.event_payload('page_view', sid));
  payload := pg_temp.event_payload('store_impression', sid, store, null, 'directory', 3);
  if public.record_directory_analytics(payload) <> 1 or public.record_directory_analytics(payload) <> 0 then raise exception 'RETRY_NOT_IDEMPOTENT'; end if;
  if public.record_directory_analytics(pg_temp.event_payload('store_impression', sid, store, null, 'directory', 5)) <> 0 then raise exception 'SEMANTIC_DUPLICATE'; end if;
  perform public.record_directory_analytics(pg_temp.event_payload('store_impression', sid, store, null, 'search', 1));
  perform public.record_directory_analytics(pg_temp.event_payload('store_click', sid, store, null, 'directory', 3));
  perform public.record_directory_analytics(pg_temp.event_payload('store_click', sid, store, null, 'search', 1));
  perform public.record_directory_analytics(pg_temp.event_payload('product_click', sid, store, 'stats-product', 'search', 1));
  perform public.record_directory_analytics(pg_temp.event_payload('search', sid, null, null, null, null, 0));
  if public.record_directory_analytics(pg_temp.event_payload('store_click', sid, '96000000-0000-4000-8000-000000000013', null, 'directory', 1)) <> 0 then raise exception 'PRIVATE_STORE_ACCEPTED'; end if;
  if public.record_directory_analytics(pg_temp.event_payload('product_click', sid, '96000000-0000-4000-8000-000000000012', 'stats-product', 'search', 1)) <> 0 then raise exception 'WRONG_STORE_PRODUCT'; end if;
  begin perform public.record_directory_analytics(pg_temp.event_payload('store_click', sid, store, null, 'directory', 0)); raise exception 'BAD_POSITION'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
-- A previous-period visit and a visit at the exact Tallinn day boundary.
insert into public.directory_analytics_events (id, session_id, event_name, event_key, device_type, occurred_at) values
  (gen_random_uuid(), gen_random_uuid(), 'page_view', '', 'desktop', (((now() at time zone 'Europe/Tallinn')::date - 7)::timestamp at time zone 'Europe/Tallinn') + interval '12 hours'),
  (gen_random_uuid(), gen_random_uuid(), 'page_view', '', 'tablet', (((now() at time zone 'Europe/Tallinn')::date - 1)::timestamp at time zone 'Europe/Tallinn'));
update public.directory_analytics_settings set started_at = now() - interval '200 days' where id;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
set local role authenticated;
do $$
declare report jsonb; detail jsonb; zero_store jsonb;
begin
  report := public.admin_directory_analytics(7);
  if report #>> '{current,visits}' <> '2' or report #>> '{previous,visits}' <> '1' then raise exception 'PERIOD_COUNTS %', report; end if;
  if report #>> '{current,impressions}' <> '1' or report #>> '{current,store_clicks}' <> '1'
    or report #>> '{current,product_clicks}' <> '1' or report #>> '{current,ctr}' <> '100.0'
    or report #>> '{current,searches}' <> '1' or report #>> '{current,empty_searches}' <> '1'
    or report #>> '{current,average_position}' <> '3.0' then raise exception 'CURRENT_METRICS %', report->'current'; end if;
  if jsonb_array_length(report->'daily') <> 7 or report #>> '{daily,5,visits}' <> '1' or report->>'comparison_available' <> 'true' then raise exception 'CALENDAR_DAYS'; end if;
  select value into zero_store from jsonb_array_elements(report->'stores') where value->>'id' = '96000000-0000-4000-8000-000000000012';
  if zero_store is null or zero_store #>> '{current,visits}' <> '0' then raise exception 'ZERO_STORE_MISSING'; end if;
  detail := public.admin_directory_analytics(7, '96000000-0000-4000-8000-000000000011');
  if detail #>> '{current,visits}' <> '1' or detail #>> '{products,0,name}' <> 'Stats cup'
    or detail #>> '{products,0,clicks}' <> '1' or jsonb_array_length(detail->'placements') <> 2 then raise exception 'DETAIL_METRICS %', detail; end if;
  if jsonb_array_length((public.admin_directory_analytics(7, '96000000-0000-4000-8000-000000000012'))->'products') <> 0 then raise exception 'PRODUCT_LEAK'; end if;
  begin perform public.admin_directory_analytics(365); raise exception 'INVALID_PERIOD'; exception when invalid_parameter_value then null; end;
  begin perform * from public.directory_analytics_events; raise exception 'ADMIN_RAW_READ'; exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.products where id = 'stats-product';
delete from public.stores where id = '96000000-0000-4000-8000-000000000011';
update public.directory_analytics_settings set started_at = now() where id;
set local role authenticated;
do $$ declare report jsonb; begin
  report := public.admin_directory_analytics(7, '96000000-0000-4000-8000-000000000011');
  if report #>> '{store,name}' <> 'Stats first' or report #>> '{products,0,name}' <> 'Stats cup' then raise exception 'DELETION_LOST_HISTORY'; end if;
  if report->>'comparison_available' <> 'false' then raise exception 'INCOMPLETE_COMPARISON_SHOWN'; end if;
end $$;
reset role;
rollback;
