\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('95000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'directory-order@example.invalid', '{}', '{}', now(), now());

insert into public.stores (id, owner_id, name, slug, is_published, created_at) values
  ('96000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'Directory first', 'directory-first', true, '2026-01-01'),
  ('96000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000001', 'Directory second', 'directory-second', true, '2026-01-02'),
  ('96000000-0000-4000-8000-000000000003', '95000000-0000-4000-8000-000000000001', 'Directory draft', 'directory-draft', false, '2026-01-03'),
  ('96000000-0000-4000-8000-000000000004', null, 'Directory ownerless', 'directory-ownerless', true, '2026-01-04');

create function pg_temp.directory_ids() returns uuid[] language sql as $$
  select coalesce(array_agg((entry ->> 'store_id')::uuid order by ordinal), '{}'::uuid[])
  from jsonb_array_elements(public.storefront_seo_catalog()) with ordinality as catalog(entry, ordinal);
$$;

set local role anon;
do $$
declare ids uuid[] := pg_temp.directory_ids();
begin
  if array_position(ids, '96000000-0000-4000-8000-000000000001') >= array_position(ids, '96000000-0000-4000-8000-000000000002')
    or not ids @> array['96000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000002']::uuid[] then
    raise exception 'TEST_DEFAULT_CREATION_ORDER';
  end if;
  if ids && array['96000000-0000-4000-8000-000000000003', '96000000-0000-4000-8000-000000000004']::uuid[] then
    raise exception 'TEST_PRIVATE_OR_OWNERLESS_STORE_EXPOSED';
  end if;
  begin
    perform public.admin_set_store_directory_order(ids, ids);
    raise exception 'TEST_ANON_CAN_REORDER';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.store_directory_order;
    raise exception 'TEST_ANON_CAN_READ_INTERNAL_ORDER_TABLE';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000001","app_metadata":{},"user_metadata":{"role":"admin"}}', true);
set local role authenticated;
do $$
declare ids uuid[] := pg_temp.directory_ids();
begin
  begin
    perform public.admin_set_store_directory_order(ids, ids);
    raise exception 'TEST_MERCHANT_CAN_REORDER';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.store_directory_order values ('96000000-0000-4000-8000-000000000001', 0);
    raise exception 'TEST_MERCHANT_CAN_SET_OWN_POSITION';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}', true);
set local role authenticated;
do $$
declare
  original_ids uuid[] := pg_temp.directory_ids();
  reordered_ids uuid[];
  response jsonb;
begin
  select array_agg(id order by ordinal desc) into reordered_ids from unnest(original_ids) with ordinality as entries(id, ordinal);
  response := public.admin_set_store_directory_order(reordered_ids, original_ids);
  if pg_temp.directory_ids() is distinct from reordered_ids
    or response is distinct from public.storefront_seo_catalog() then
    raise exception 'TEST_SAVED_ORDER_OR_RESPONSE_MISMATCH';
  end if;

  begin
    perform public.admin_set_store_directory_order(original_ids, original_ids);
    raise exception 'TEST_STALE_ADMIN_CAN_OVERWRITE';
  exception when serialization_failure then null;
  end;
  begin
    perform public.admin_set_store_directory_order(reordered_ids || reordered_ids[1], reordered_ids);
    raise exception 'TEST_DUPLICATE_STORE_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_store_directory_order(reordered_ids[2:cardinality(reordered_ids)], reordered_ids);
    raise exception 'TEST_MISSING_STORE_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_store_directory_order(array['96000000-0000-4000-8000-000000000003']::uuid[] || reordered_ids[2:cardinality(reordered_ids)], reordered_ids);
    raise exception 'TEST_UNPUBLISHED_STORE_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_store_directory_order(array['ffffffff-ffff-ffff-ffff-ffffffffffff']::uuid[] || reordered_ids[2:cardinality(reordered_ids)], reordered_ids);
    raise exception 'TEST_UNKNOWN_STORE_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_store_directory_order(null, reordered_ids);
    raise exception 'TEST_NULL_ORDER_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_store_directory_order(reordered_ids || array[null]::uuid[], reordered_ids);
    raise exception 'TEST_NULL_STORE_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_store_directory_order(reordered_ids, null);
    raise exception 'TEST_MISSING_BASELINE_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;
  begin
    delete from public.store_directory_order;
    raise exception 'TEST_ADMIN_CAN_BYPASS_RPC';
  exception when insufficient_privilege then null;
  end;
  if pg_temp.directory_ids() is distinct from reordered_ids then
    raise exception 'TEST_REJECTED_SAVE_CHANGED_ORDER';
  end if;
  perform set_config('test.directory_saved_ids', reordered_ids::text, true);
end;
$$;

reset role;
-- Even a store created earlier joins the end when it becomes public later.
insert into public.stores (id, owner_id, name, slug, is_published, created_at) values
  ('96000000-0000-4000-8000-000000000005', '95000000-0000-4000-8000-000000000001', 'Directory newcomer', 'directory-newcomer', true, '2025-01-01');
set local role authenticated;
do $$
declare saved_ids uuid[] := current_setting('test.directory_saved_ids')::uuid[];
begin
  if pg_temp.directory_ids() is distinct from saved_ids || '96000000-0000-4000-8000-000000000005'::uuid then
    raise exception 'TEST_NEW_STORE_NOT_APPENDED';
  end if;
  begin
    perform public.admin_set_store_directory_order(saved_ids, saved_ids);
    raise exception 'TEST_NEW_STORE_SILENTLY_OMITTED';
  exception when serialization_failure then null;
  end;
end;
$$;

reset role;
update public.stores set is_published = false where id = '96000000-0000-4000-8000-000000000001';
delete from public.stores where id = '96000000-0000-4000-8000-000000000002';
do $$
begin
  if exists (select 1 from public.store_directory_order where store_id = '96000000-0000-4000-8000-000000000002') then
    raise exception 'TEST_DELETED_STORE_POSITION_NOT_REMOVED';
  end if;
end;
$$;
set local role anon;
do $$
begin
  if pg_temp.directory_ids() && array['96000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000002']::uuid[] then
    raise exception 'TEST_UNPUBLISHED_OR_DELETED_STORE_STILL_PUBLIC';
  end if;
end;
$$;

rollback;
