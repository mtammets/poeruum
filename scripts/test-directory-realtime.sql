\set ON_ERROR_STOP on
load 'safeupdate';
begin;

-- Run on a local database: everything, including the signals, rolls back.
do $$
declare before_revision bigint;
  event_id uuid := gen_random_uuid();
  visit_id uuid := gen_random_uuid();
begin
  select revision into before_revision from public.admin_directory_refresh where id;
  insert into public.directory_analytics_events (id,session_id,event_name,event_key,device_type)
  values (gen_random_uuid(),visit_id,'page_view','','desktop');
  if (select revision from public.admin_directory_refresh where id) <> before_revision then raise exception 'PAGE_VIEW_SIGNAL'; end if;
  insert into public.directory_analytics_events (id,session_id,event_name,event_key,device_type)
  values (event_id,visit_id,'store_click','test','desktop');
  if (select revision from public.admin_directory_refresh where id) <> before_revision+1 then raise exception 'MISSING_CLICK_SIGNAL'; end if;
  insert into public.directory_analytics_events (id,session_id,event_name,event_key,device_type)
  values (event_id,visit_id,'store_click','test','desktop') on conflict do nothing;
  if (select revision from public.admin_directory_refresh where id) <> before_revision+1 then raise exception 'DUPLICATE_SIGNAL'; end if;
  insert into public.directory_analytics_events (id,session_id,event_name,event_key,device_type)
  values (gen_random_uuid(),visit_id,'store_impression','test','desktop'),
    (gen_random_uuid(),visit_id,'product_click','test','desktop');
  if (select revision from public.admin_directory_refresh where id) <> before_revision+2 then raise exception 'BATCH_SIGNAL'; end if;
  update public.directory_analytics_settings set started_at=started_at where id;
  if (select revision from public.admin_directory_refresh where id) <> before_revision+3 then raise exception 'SETTINGS_SIGNAL'; end if;
  update public.stores set name=name where false;
  if (select revision from public.admin_directory_refresh where id) <> before_revision+4 then raise exception 'STORE_SIGNAL'; end if;
  if not exists(select from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='admin_directory_refresh') then raise exception 'MISSING_PUBLICATION'; end if;
  if exists(select from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='directory_analytics_events') then raise exception 'RAW_EVENTS_PUBLISHED'; end if;
end $$;

set local role anon;
do $$ begin
  begin perform * from public.admin_directory_refresh; raise exception 'ANON_SIGNAL_ACCESS'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"user_metadata":{"role":"admin"},"app_metadata":{}}', true);
set local role authenticated;
do $$ begin
  if exists(select from public.admin_directory_refresh) then raise exception 'MERCHANT_SIGNAL_ACCESS'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.admin_directory_refresh) <> 1 then raise exception 'ADMIN_SIGNAL_UNAVAILABLE'; end if;
  begin update public.admin_directory_refresh set revision=0 where id; raise exception 'ADMIN_SIGNAL_WRITE'; exception when insufficient_privilege then null; end;
  begin perform * from public.directory_analytics_events; raise exception 'RAW_EVENT_ACCESS'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
