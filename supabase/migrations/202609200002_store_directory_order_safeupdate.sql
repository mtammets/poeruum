-- Make admin ordering compatible with the safeupdate guard used by PostgREST.
create or replace function public.admin_set_store_directory_order(ordered_store_ids uuid[], expected_store_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_store_ids uuid[];
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if ordered_store_ids is null or expected_store_ids is null
    or coalesce(array_ndims(ordered_store_ids), 1) <> 1
    or cardinality(ordered_store_ids) <> (select count(distinct id) from unnest(ordered_store_ids) id)
  then
    raise exception 'Invalid store order' using errcode = '22023';
  end if;

  -- Serialize saves, then reject stale lists instead of overwriting another admin.
  lock table public.store_directory_order in exclusive mode;
  select coalesce(array_agg((entry ->> 'store_id')::uuid order by ordinal), '{}'::uuid[])
    into current_store_ids
    from jsonb_array_elements(public.storefront_seo_catalog()) with ordinality as catalog(entry, ordinal);

  if expected_store_ids is distinct from current_store_ids then
    raise exception 'Store directory changed; reload before saving' using errcode = '40001';
  end if;

  if cardinality(ordered_store_ids) <> cardinality(current_store_ids)
    or not (ordered_store_ids @> current_store_ids and ordered_store_ids <@ current_store_ids)
  then
    raise exception 'Order must contain every public store exactly once' using errcode = '22023';
  end if;

  -- PostgREST loads safeupdate: every DELETE must target rows explicitly.
  -- Remove obsolete placements and update the requested stores in place.
  delete from public.store_directory_order
    where not (store_id = any (ordered_store_ids));
  insert into public.store_directory_order (store_id, position)
    select id, (ordinal - 1)::integer
    from unnest(ordered_store_ids) with ordinality as ordered(id, ordinal)
    on conflict (store_id) do update set position = excluded.position;

  return public.storefront_seo_catalog();
end;
$$;

revoke all on function public.admin_set_store_directory_order(uuid[], uuid[]) from public, anon;
grant execute on function public.admin_set_store_directory_order(uuid[], uuid[]) to authenticated;
