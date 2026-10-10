-- Keep public shops in the SEO catalog while allowing merchants to opt out
-- of directory discovery. Missing settings preserve existing visibility.
create or replace function public.storefront_seo_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'store_id', stores.id,
      'store_name', stores.name,
      'store_slug', stores.slug,
      'primary_hostname', coalesce((
        select domains.hostname
        from public.custom_domains domains
        where domains.store_id = stores.id and domains.status = 'active'
        limit 1
      ), stores.slug || '.poeruum.ee'),
      'store_updated_at', stores.updated_at,
      'store_description', coalesce(stores.settings ->> 'seoDescription', stores.settings ->> 'storeDescription', ''),
      'store_seo_title', nullif(stores.settings ->> 'seoTitle', ''),
      'store_logo', stores.settings ->> 'storeLogo',
      'directory_description', coalesce(
        nullif(btrim(regexp_replace(stores.settings ->> 'directoryDescription', '\s+', ' ', 'g')), ''),
        nullif(btrim(regexp_replace(stores.settings ->> 'storeDescription', '\s+', ' ', 'g')), ''),
        ''
      ),
      'directory_visible', (stores.settings -> 'directoryVisible') is distinct from 'false'::jsonb,
      'directory_cover', nullif(stores.settings ->> 'directoryCover', ''),
      'products', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', products.id,
            'name', products.name,
            'slug', coalesce(nullif(products.slug, ''), products.id),
            'description', coalesce(products.description, ''),
            'seo_title', coalesce(nullif(products.seo_title, ''), products.name || ' – ' || stores.name),
            'image_url', products.image_url,
            'alt', coalesce(nullif(products.alt, ''), products.name),
            'price', products.price,
            'sale_price', products.sale_price,
            'stock', products.stock,
            'one_of_a_kind', products.one_of_a_kind,
            'updated_at', products.updated_at
          )
          order by products.sort_order, products.created_at
        )
        from public.products
        where products.store_id = stores.id
          and products.search_visible = true
      ), '[]'::jsonb)
    )
    order by directory_order.position nulls last, stores.created_at, stores.id
  ), '[]'::jsonb)
  from public.stores
  left join public.store_directory_order directory_order on directory_order.store_id = stores.id
  where stores.is_published = true
    and stores.owner_id is not null
    and lower(stores.slug) not in ('test', 'kaubamaja');
$$;

revoke all on function public.storefront_seo_catalog() from public;
grant execute on function public.storefront_seo_catalog() to anon, authenticated;

-- Ordering uses the same visible set as the directory UI. Hidden shops
-- must not cause a permanent stale-list conflict for administrators.
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
    from jsonb_array_elements(public.storefront_seo_catalog()) with ordinality as catalog(entry, ordinal)
    where (entry -> 'directory_visible') is distinct from 'false'::jsonb;

  if expected_store_ids is distinct from current_store_ids then
    raise exception 'Store directory changed; reload before saving' using errcode = '40001';
  end if;

  if cardinality(ordered_store_ids) <> cardinality(current_store_ids)
    or not (ordered_store_ids @> current_store_ids and ordered_store_ids <@ current_store_ids)
  then
    raise exception 'Order must contain every directory-visible store exactly once' using errcode = '22023';
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
