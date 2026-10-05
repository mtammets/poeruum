\set ON_ERROR_STOP on
begin;
select to_regclass('public.admin_push_subscriptions') is null as needs_migration \gset
\if :needs_migration
  \ir ../supabase/migrations/202610050002_admin_push.sql
\endif
create function pg_temp.verify(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end; $$;
create extension if not exists plpgsql_check with schema extensions;
select pg_temp.verify(not exists(select 1 from extensions.plpgsql_check_function_tb('public.enqueue_admin_push()', 'auth.users') where level in ('error','warning')), 'Account trigger failed static checking');
select pg_temp.verify(not exists(select 1 from extensions.plpgsql_check_function_tb('public.enqueue_admin_push()', 'public.homepage_analytics_events') where level in ('error','warning')), 'Visit trigger failed static checking');
-- Never dispatch network requests from fixtures, even when run against a configured local DB.
create or replace function public.dispatch_admin_push() returns void language plpgsql as $$ begin return; end; $$;
insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('91000000-0000-4000-8000-000000000001','authenticated','authenticated','push-admin@example.invalid','{"role":"admin"}','{}');
insert into public.admin_push_subscriptions(id,user_id,endpoint,p256dh,auth) values
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','https://web.push.apple.com/test-one',repeat('A',87),repeat('B',22)),
('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','https://fcm.googleapis.com/test-two',repeat('A',87),repeat('B',22));
select pg_temp.verify(not exists(select 1 from public.admin_push_jobs),'Subscription backfilled old events');
insert into public.homepage_analytics_events(session_id,event_name,device_type)
values ('push-test-session-one','page_view','mobile'),('push-test-session-one','signup_start','mobile');
insert into public.homepage_analytics_events(session_id,event_name,device_type)
values ('push-test-session-one','page_view','mobile') on conflict do nothing;
select pg_temp.verify((select count(*)=2 from public.admin_push_jobs where kind='visit'),'Visit did not fan out once per device or signup_start created a notification');
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
('91000000-0000-4000-8000-000000000002','authenticated','authenticated','push-merchant@example.invalid','{}','{}'),
('91000000-0000-4000-8000-000000000003','authenticated','authenticated','push-admin-two@example.invalid','{"role":"admin"}','{}');
select pg_temp.verify((select count(*)=2 from public.admin_push_jobs where kind='account'),'Account notification missing or admin signup included');
select pg_temp.verify(not has_table_privilege('authenticated','public.admin_push_subscriptions','select'), 'Subscriptions exposed to users');
select pg_temp.verify(not has_table_privilege('anon','public.admin_push_jobs','select'), 'Jobs exposed anonymously');
select pg_temp.verify(not has_function_privilege('authenticated','public.claim_admin_push_job()','execute'), 'Browser can claim notifications');
select pg_temp.verify(not has_function_privilege('anon','public.dispatch_admin_push()','execute'), 'Anonymous dispatch allowed');
do $$ declare first_job record; second_job record; reclaimed record;
begin
  select * into first_job from public.claim_admin_push_job();
  select * into second_job from public.claim_admin_push_job();
  perform pg_temp.verify(first_job.id <> second_job.id, 'Leased job was claimed twice');
  perform pg_temp.verify(not public.finish_admin_push_job(first_job.id,gen_random_uuid(),'sent'), 'Wrong lease completed job');
  perform pg_temp.verify(public.finish_admin_push_job(first_job.id,first_job.lease_token,'retry'), 'Retry failed');
  perform pg_temp.verify((select available_at > now() from public.admin_push_jobs where id=first_job.id), 'Retry spins without backoff');
  update public.admin_push_jobs set available_at=now()-interval '1 second' where id=first_job.id;
  -- Keep other jobs leased so the expired one is the only candidate.
  update public.admin_push_jobs set available_at=now()+interval '1 minute' where id<>first_job.id;
  select * into reclaimed from public.claim_admin_push_job();
  perform pg_temp.verify(reclaimed.id=first_job.id and reclaimed.lease_token<>first_job.lease_token, 'Expired lease cannot be retried');
  perform pg_temp.verify(not public.finish_admin_push_job(first_job.id,first_job.lease_token,'gone'), 'Stale worker deleted subscription');
  perform pg_temp.verify(public.finish_admin_push_job(reclaimed.id,reclaimed.lease_token,'sent'), 'Send completion failed');
  perform pg_temp.verify(not exists(select 1 from public.admin_push_jobs where id=reclaimed.id), 'Sent job retained');
  perform pg_temp.verify(public.finish_admin_push_job(second_job.id,second_job.lease_token,'gone'), 'Expired subscription removal failed');
  perform pg_temp.verify(not exists(select 1 from public.admin_push_subscriptions where id=second_job.subscription_id), 'Expired subscription retained');
end; $$;
update auth.users set raw_app_meta_data='{}' where id='91000000-0000-4000-8000-000000000001';
select * from public.claim_admin_push_job();
select pg_temp.verify(not exists(select 1 from public.admin_push_subscriptions),'Revoked admin still receives notifications');
select pg_temp.verify(not exists(select 1 from public.admin_push_jobs),'Unsubscribed devices leave queued notifications');
rollback;
