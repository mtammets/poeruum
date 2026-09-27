alter table public.platform_settings
  add column homepage_store_ids uuid[] not null default '{}';

update public.platform_settings
set homepage_store_ids = array(
  select id from public.stores
  where slug in ('moreamoreceramics', 'kruk-kruk') and owner_id is not null
  order by slug
)
where id = 'homepage';

create function public.admin_homepage_showcase()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'selectedStoreIds', (select homepage_store_ids from public.platform_settings where id = 'homepage'),
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'slug', s.slug, 'isPublished', s.is_published,
        'eligibleProductCount', (
          select count(*) from public.products p
          where p.store_id = s.id and p.search_visible
            and p.image_url ~ '^https?://[^/]+/storage/v1/object/public/product-images/'
            and p.price is not null and p.price >= 0 and (p.stock is null or p.stock > 0)
        )
      ) order by lower(s.name), s.id)
      from public.stores s
      where s.owner_id is not null and lower(s.slug) not in ('test', 'kaubamaja')
    ), '[]'::jsonb)
  );
end;
$$;

create function public.admin_set_homepage_showcase(selected_store_ids uuid[], expected_store_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare current_ids uuid[];
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if selected_store_ids is null or cardinality(selected_store_ids) = 0
    or array_ndims(selected_store_ids) <> 1
    or cardinality(selected_store_ids) <> (select count(distinct id) from unnest(selected_store_ids) id)
    or exists (
      select 1 from unnest(selected_store_ids) requested(id)
      where not exists (select 1 from public.stores s where s.id = requested.id
        and s.owner_id is not null and lower(s.slug) not in ('test', 'kaubamaja'))
    )
  then
    raise exception 'Select at least one valid store' using errcode = '22023';
  end if;

  select homepage_store_ids into current_ids from public.platform_settings where id = 'homepage' for update;
  if current_ids is distinct from expected_store_ids then
    raise exception 'Homepage selection changed; reload before saving' using errcode = '40001';
  end if;

  update public.platform_settings
  set homepage_store_ids = selected_store_ids, updated_at = now(), updated_by = auth.uid()
  where id = 'homepage';
  return public.admin_homepage_showcase();
end;
$$;

revoke all on function public.admin_homepage_showcase() from public, anon;
revoke all on function public.admin_set_homepage_showcase(uuid[], uuid[]) from public, anon;
grant execute on function public.admin_homepage_showcase() to authenticated;
grant execute on function public.admin_set_homepage_showcase(uuid[], uuid[]) to authenticated;
