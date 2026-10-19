-- Show the newest products first within each explicit sort position.
-- Keep storefront, directory and paginated admin previews in the same order.

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
          order by products.sort_order, products.created_at desc, products.id
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


create or replace function public.storefront_seo_document(requested_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'store_id', s.id,
    'store_name', s.name,
    'store_slug', s.slug,
    'store_updated_at', s.updated_at,
    'settings', jsonb_strip_nulls(jsonb_build_object(
      'storeDescription', s.settings -> 'storeDescription',
      'seoTitle', s.settings -> 'seoTitle',
      'seoDescription', s.settings -> 'seoDescription',
      'productBrand', s.settings -> 'productBrand',
      'searchConsoleVerification', s.settings -> 'searchConsoleVerification',
      'storeLogo', s.settings -> 'storeLogo',
      'socialImage', s.settings -> 'socialImage',
      'businessName', s.settings -> 'businessName',
      'sellerType', s.settings -> 'sellerType',
      'deliverySettings', s.settings -> 'deliverySettings',
      'returnsText', s.settings -> 'returnsText',
      'contactEmail', s.settings -> 'contactEmail',
      'contactPhone', s.settings -> 'contactPhone'
    )),
    'shipping', s.shipping,
    'primary_hostname', coalesce((
      select d.hostname
      from public.custom_domains d
      where d.store_id = s.id and d.status = 'active'
      limit 1
    ), s.slug || '.poeruum.ee'),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'slug', coalesce(nullif(p.slug, ''), p.id),
          'description', coalesce(p.description, ''),
          'seo_title', coalesce(nullif(p.seo_title, ''), p.name || ' – ' || s.name),
          'image_url', p.image_url,
          'gallery', p.gallery,
          'alt', coalesce(nullif(p.alt, ''), p.name),
          'price', p.price,
          'sale_price', p.sale_price,
          'stock', p.stock,
          'one_of_a_kind', p.one_of_a_kind,
          'options', p.options,
          'search_visible', p.search_visible,
          'updated_at', p.updated_at
        )
        order by p.sort_order, p.created_at desc, p.id
      )
      from public.products p
      where p.store_id = s.id
    ), '[]'::jsonb),
    'url_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'old_slug', h.old_slug,
        'new_slug', h.new_slug,
        'status', h.status
      ))
      from public.product_url_history h
      where h.store_id = s.id
    ), '[]'::jsonb)
  )
  from public.stores s
  where s.slug = lower(btrim(requested_slug))
    and s.is_published = true
    and s.owner_id is not null
  limit 1;
$$;

revoke all on function public.storefront_seo_document(text) from public;
grant execute on function public.storefront_seo_document(text) to anon, authenticated;

-- Read-only photo preview for administrators, including unpublished stores.
create or replace function public.admin_store_products(target_store_id uuid, page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if coalesce((select auth.jwt()->'app_metadata'->>'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if page_offset is null or page_offset < 0 then
    raise exception 'Invalid offset' using errcode = '22023';
  end if;
  if not exists (select from public.stores where id = target_store_id) then
    raise exception 'Store not found' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'version', 1, 'store_id', target_store_id, 'offset', page_offset,
    'total', (select count(*) from public.products where store_id = target_store_id),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'image_url', p.image_url, 'gallery', p.gallery, 'alt', p.alt
    ) order by p.sort_order, p.created_at desc, p.id) from (
      select id, name, image_url, gallery, alt, sort_order, created_at
      from public.products where store_id = target_store_id
      order by sort_order, created_at desc, id limit 48 offset page_offset
    ) p), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_store_products(uuid, integer) from public, anon;
grant execute on function public.admin_store_products(uuid, integer) to authenticated;
comment on function public.admin_store_products(uuid, integer) is
  'Admin-only product image preview. Returns at most 48 products in storefront order; does not change products or store publication.';
