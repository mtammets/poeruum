update public.stores
set is_published = false
where lower(slug) = 'test'
  and is_published = true;

alter table public.stores
  add constraint stores_test_slug_not_public
  check (lower(slug) <> 'test' or is_published = false);

comment on constraint stores_test_slug_not_public on public.stores is
  'Keeps the internal test storefront unpublished and out of search engines.';

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
      'store_updated_at', stores.updated_at,
      'store_description', coalesce(stores.settings ->> 'storeDescription', ''),
      'store_logo', stores.settings ->> 'storeLogo',
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
    order by stores.created_at
  ), '[]'::jsonb)
  from public.stores
  where stores.is_published = true
    and stores.owner_id is not null
    and lower(stores.slug) <> 'test';
$$;

revoke all on function public.storefront_seo_catalog() from public;
grant execute on function public.storefront_seo_catalog() to anon, authenticated;
