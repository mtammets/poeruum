\set ON_ERROR_STOP on
load 'safeupdate';
begin;

do $$
declare base bigint;
  event_id uuid := gen_random_uuid();
  visit_id text := gen_random_uuid()::text;
begin
  select revision into base from public.admin_homepage_refresh where id;
  insert into public.homepage_analytics_events (id,session_id,event_name,device_type,engaged_seconds)
  values (event_id,visit_id,'page_view','desktop',0);
  if (select revision from public.admin_homepage_refresh where id) <> base+1 then raise exception 'NO_VISIT_SIGNAL'; end if;
  insert into public.homepage_analytics_events (id,session_id,event_name,device_type)
  values (event_id,visit_id,'page_view','desktop') on conflict do nothing;
  if (select revision from public.admin_homepage_refresh where id) <> base+1 then raise exception 'DUPLICATE_VISIT_SIGNAL'; end if;
  update public.homepage_analytics_events set engaged_seconds=16 where id=event_id;
  if (select revision from public.admin_homepage_refresh where id) <> base+2 then raise exception 'NO_ENGAGEMENT_SIGNAL'; end if;
  update public.homepage_analytics_events set engaged_seconds=16 where id=event_id;
  if (select revision from public.admin_homepage_refresh where id) <> base+2 then raise exception 'UNCHANGED_ENGAGEMENT_SIGNAL'; end if;
  -- Real ingestion keeps cumulative time monotonic; a delayed retry is quiet.
  perform public.record_homepage_engagement(visit_id,'anonymous','','','','','desktop',10);
  if (select revision from public.admin_homepage_refresh where id) <> base+2 then raise exception 'OLDER_ENGAGEMENT_SIGNAL'; end if;
  perform public.record_homepage_engagement(visit_id,'anonymous','','','','','desktop',30);
  if (select revision from public.admin_homepage_refresh where id) <> base+3 then raise exception 'NO_UPSERT_ENGAGEMENT_SIGNAL'; end if;
  update public.admin_dashboard_refresh set revision=revision+1 where id;
  if (select revision from public.admin_homepage_refresh where id) <> base+4 then raise exception 'NO_COHORT_SIGNAL'; end if;
  delete from public.homepage_analytics_events where id=event_id;
  if (select revision from public.admin_homepage_refresh where id) <> base+5 then raise exception 'NO_RETENTION_SIGNAL'; end if;
  if not exists(select from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='admin_homepage_refresh') then raise exception 'NO_PUBLICATION'; end if;
  if exists(select from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='homepage_analytics_events') then raise exception 'RAW_EVENTS_PUBLISHED'; end if;
end $$;

set local role anon;
do $$ begin
  begin perform * from public.admin_homepage_refresh; raise exception 'ANON_ACCESS'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"user_metadata":{"role":"admin"},"app_metadata":{}}', true);
set local role authenticated;
do $$ begin
  if exists(select from public.admin_homepage_refresh) then raise exception 'MERCHANT_ACCESS'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.admin_homepage_refresh) <> 1 then raise exception 'ADMIN_CANNOT_READ'; end if;
  begin update public.admin_homepage_refresh set revision=0 where id; raise exception 'ADMIN_CAN_WRITE'; exception when insufficient_privilege then null; end;
  begin perform * from public.homepage_analytics_events; raise exception 'RAW_EVENT_ACCESS'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
