-- Runs inside test-admin-push.sql's transaction with network dispatch disabled.
savepoint directory_push_test;
select pg_temp.verify((select bool_and(directory_visits_enabled) from public.admin_push_subscriptions), 'Directory visits are not enabled by default');
select pg_temp.verify(not exists(select 1 from public.admin_push_jobs where kind='directory_visit'), 'Directory notifications backfilled past visits');

select public.record_directory_analytics('[
  {"id":"98000000-0000-4000-8000-000000000001","session_id":"99000000-0000-4000-8000-000000000001","event_name":"page_view","device_type":"mobile"},
  {"id":"98000000-0000-4000-8000-000000000002","session_id":"99000000-0000-4000-8000-000000000001","event_name":"search","result_count":0,"device_type":"mobile"}
]');
-- Both a retried batch and a new event ID within the same visit are duplicates.
select public.record_directory_analytics('[
  {"id":"98000000-0000-4000-8000-000000000001","session_id":"99000000-0000-4000-8000-000000000001","event_name":"page_view","device_type":"mobile"},
  {"id":"98000000-0000-4000-8000-000000000003","session_id":"99000000-0000-4000-8000-000000000001","event_name":"page_view","device_type":"mobile"}
]');
insert into public.directory_analytics_events(id,session_id,event_name,event_key,device_type)
select gen_random_uuid(),'99000000-0000-4000-8000-000000000001',event_name,event_name,'mobile'
from unnest(array['store_impression','store_click','product_click']) event_name;
select pg_temp.verify((select count(*)=2 from public.admin_push_jobs where kind='directory_visit'), 'Directory visit did not fan out once per device or non-visit events notified');
select pg_temp.verify((select count(*)=4 from public.admin_push_jobs where kind in ('visit','account')), 'Directory visits used an existing notification category');

update public.admin_push_subscriptions set directory_visits_enabled=false where id='92000000-0000-4000-8000-000000000001';
select pg_temp.verify((select count(*)=1 from public.admin_push_jobs where kind='directory_visit'), 'Muting directory did not prune only this device');
select pg_temp.verify((select count(*)=2 from public.admin_push_jobs where kind='visit'), 'Muting directory affected homepage visits');
update public.admin_push_subscriptions set visits_enabled=false where id='92000000-0000-4000-8000-000000000002';
select public.record_directory_analytics('[
  {"id":"98000000-0000-4000-8000-000000000004","session_id":"99000000-0000-4000-8000-000000000002","event_name":"page_view","device_type":"desktop"}
]');
select pg_temp.verify((select count(*)=2 from public.admin_push_jobs where kind='directory_visit'), 'Directory visits depended on homepage preference or ignored their own preference');
select pg_temp.verify(not exists(select 1 from public.admin_push_jobs where kind='directory_visit' and subscription_id='92000000-0000-4000-8000-000000000001'), 'Muted device receives directory visits');

-- A delayed enqueue racing with the preference update must be pruned at claim.
update public.admin_push_jobs set available_at=now()+interval '1 minute';
insert into public.admin_push_jobs(subscription_id,event_id,kind) values
('92000000-0000-4000-8000-000000000001',gen_random_uuid(),'directory_visit');
select pg_temp.verify(not exists(select 1 from public.claim_admin_push_job()), 'Worker claimed muted directory visits');
update public.admin_push_jobs set available_at=now() where kind='directory_visit';
do $$ declare directory_job record;
begin
  select * into directory_job from public.claim_admin_push_job();
  perform pg_temp.verify(directory_job.kind='directory_visit' and directory_job.subscription_id='92000000-0000-4000-8000-000000000002', 'Worker did not claim enabled directory visit');
  perform pg_temp.verify(public.finish_admin_push_job(directory_job.id,directory_job.lease_token,'sent'), 'Directory job completion failed');
end; $$;
update public.admin_push_subscriptions set directory_visits_enabled=false;
select pg_temp.verify(not exists(select 1 from public.admin_push_jobs where kind='directory_visit'), 'Muting directory left queued visits');
update public.admin_push_subscriptions set directory_visits_enabled=true;
select pg_temp.verify(not exists(select 1 from public.admin_push_jobs where kind='directory_visit'), 'Re-enabling directory backfilled past visits');
rollback to savepoint directory_push_test;
