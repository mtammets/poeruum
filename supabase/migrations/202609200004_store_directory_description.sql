-- Resolve the directory copy from merchant-authored presentation fields.
-- Keep store_description's separate SEO contract for generated SEO assets.
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
