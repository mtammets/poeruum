\set ON_ERROR_STOP on
begin;
create function pg_temp.verify(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end; $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('89000000-0000-4000-8000-000000000001','authenticated','authenticated','campaign-admin@example.invalid','{"role":"admin"}','{}',now(),now());

set local role anon;
select pg_temp.verify(public.get_directory_campaign()->>'mode' is not null, 'Public configuration unavailable');
do $$ begin
  begin
    perform public.admin_set_directory_campaign('on',null,null,0);
    raise exception 'Anonymous mutation accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.directory_campaign_settings;
    raise exception 'Public audit access accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local request.jwt.claims = '{"sub":"89000000-0000-4000-8000-000000000001","app_metadata":{},"user_metadata":{"role":"admin"}}';
set local role authenticated;
do $$ begin
  begin
    perform public.admin_set_directory_campaign('on',null,null,0);
    raise exception 'Merchant or editable role claim accepted';
  exception when insufficient_privilege then null; end;
end $$;

set local request.jwt.claims = '{"sub":"89000000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}';
do $$
declare original jsonb := public.get_directory_campaign(); result jsonb; revision integer;
begin
  revision := (original->>'revision')::integer;
  result := public.admin_set_directory_campaign('scheduled','2026-11-27 08:00+02','2026-12-01 00:00+02',revision);
  perform pg_temp.verify(result->>'mode' = 'scheduled' and (result->>'revision')::integer = revision + 1, 'Schedule not saved');
  perform pg_temp.verify((result->>'startsAt')::timestamptz = '2026-11-27 06:00Z'::timestamptz, 'Schedule timezone incorrect');
  perform pg_temp.verify(result->>'updated_by' is null and result->>'serverNow' is not null, 'Audit leak or missing server clock');
  begin
    perform public.admin_set_directory_campaign('off',null,null,revision);
    raise exception 'Stale revision accepted';
  exception when sqlstate '40001' then null; end;
  begin
    perform public.admin_set_directory_campaign('scheduled',null,null,revision+1);
    raise exception 'Empty schedule accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.admin_set_directory_campaign('scheduled','2026-11-28','2026-11-27',revision+1);
    raise exception 'Reversed interval accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.admin_set_directory_campaign('scheduled','2026-11-27','infinity',revision+1);
    raise exception 'Infinite schedule accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.admin_set_directory_campaign(null,null,null,revision+1);
    raise exception 'Null mode accepted';
  exception when sqlstate '22023' then null; end;
  perform pg_temp.verify((public.get_directory_campaign()->>'revision')::integer = revision+1, 'Rejected save changed settings');
  result := public.admin_set_directory_campaign('on',null,null,revision+1);
  perform pg_temp.verify(result->>'mode' = 'on', 'Manual start failed');
  result := public.admin_set_directory_campaign('off',null,null,revision+2);
  perform pg_temp.verify(result->>'mode' = 'off', 'Manual stop failed');
  begin
    update public.directory_campaign_settings set mode = 'on';
    raise exception 'Direct mutation bypass accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.verify((select updated_by = '89000000-0000-4000-8000-000000000001' from public.directory_campaign_settings), 'Missing audit identity');
rollback;
