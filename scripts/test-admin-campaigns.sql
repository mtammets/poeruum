\set ON_ERROR_STOP on
begin;
select to_regclass('public.admin_campaign_versions') is null as campaign_migration_needed \gset
\if :campaign_migration_needed
\ir ../supabase/migrations/202610050001_admin_campaigns.sql
\endif
create function pg_temp.verify(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end; $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('85000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','campaign-test-'||n||'@example.invalid',
  case when n<2 then '{"role":"admin"}'::jsonb else '{}'::jsonb end,'{}',now(),now()
from generate_series(0,2) n;
select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000000","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
insert into public.admin_campaign_versions(campaign_id,name,template,document)
values ('86000000-0000-4000-8000-000000000000','Test','phone','{"version":1,"copy":{},"media":[{},{},{}]}');
select pg_temp.verify((select count(*)=1 from public.admin_campaign_versions),'Owner cannot read own campaign');
do $$ begin
  begin
    insert into public.admin_campaign_versions(user_id,campaign_id,name,template,document)
    values ('85000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000000','Test','phone','{"version":1,"copy":{},"media":[{},{},{}]}');
    raise exception 'Admin can write another user campaign';
  exception when insufficient_privilege then null; end;
  begin update public.admin_campaign_versions set name='Changed'; raise exception 'Version can be overwritten';
  exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}',true);
select pg_temp.verify((select count(*)=0 from public.admin_campaign_versions),'Another admin can read private campaigns');
select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000002","app_metadata":{}}',true);
select pg_temp.verify((select count(*)=0 from public.admin_campaign_versions),'Merchant can read campaigns');
do $$ begin
  begin
    insert into public.admin_campaign_versions(campaign_id,name,template,document)
    values ('86000000-0000-4000-8000-000000000000','Test','phone','{"version":1,"copy":{},"media":[{},{},{}]}');
    raise exception 'Merchant can create campaign';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
select pg_temp.verify(not has_table_privilege('anon','public.admin_campaign_versions','select'),'Anonymous read allowed');
select pg_temp.verify(not has_table_privilege('anon','public.admin_campaign_versions','insert'),'Anonymous write allowed');
rollback;
