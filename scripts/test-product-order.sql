\set ON_ERROR_STOP on
begin;

insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('c7190000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'product-order-' || n || '@example.invalid', '{}', '{}', now(), now()
from generate_series(1, 2) n;
insert into public.stores(id, owner_id, name, slug, is_published) values
  ('c7190001-0000-4000-8000-000000000001', 'c7190000-0000-4000-8000-000000000001', 'Product order', 'product-order-public', true),
  ('c7190001-0000-4000-8000-000000000002', 'c7190000-0000-4000-8000-000000000002', 'Private order', 'product-order-private', false);
insert into public.products(id, store_id, name, image_url, created_at, sort_order, search_visible)
select id, 'c7190001-0000-4000-8000-000000000001', id, 'https://example.invalid/photo.webp', created_at::timestamptz, position, visible
from (values
  ('order-old', '2026-01-01', 0, true),
  ('order-new', '2026-01-03', 0, true),
  ('order-tie-b', '2026-01-04', 0, true),
  ('order-tie-a', '2026-01-04', 0, true),
  ('order-manual', '2026-01-10', 1, true),
  ('order-hidden', '2026-01-15', 0, false)
) as fixture(id, created_at, position, visible);
insert into public.products(id, store_id, name, image_url) values
  ('order-private', 'c7190001-0000-4000-8000-000000000002', 'Private', 'https://example.invalid/private.webp');
-- Editing an older product changes updated_at, but must not promote it.
update public.products set name = 'Updated old product' where id = 'order-old';

create function pg_temp.product_ids(items jsonb) returns text[] language sql as $$
  select array_agg(item->>'id' order by ordinal)
  from jsonb_array_elements(items) with ordinality as entries(item, ordinal);
$$;

set local role anon;
do $$
declare catalog jsonb := public.storefront_seo_catalog(); entry jsonb; document jsonb;
begin
  select value into entry from jsonb_array_elements(catalog) where value->>'store_slug' = 'product-order-public';
  if pg_temp.product_ids(entry->'products') is distinct from array['order-tie-a','order-tie-b','order-new','order-old','order-manual'] then
    raise exception 'Directory product order must be newest first with stable ties and explicit sort positions';
  end if;
  document := public.storefront_seo_document('product-order-public');
  if pg_temp.product_ids(document->'products') is distinct from array['order-hidden','order-tie-a','order-tie-b','order-new','order-old','order-manual'] then
    raise exception 'Storefront product order differs from the directory';
  end if;
  if public.storefront_seo_document('product-order-private') is not null
    or exists(select from jsonb_array_elements(catalog) where value->>'store_slug' = 'product-order-private') then
    raise exception 'Ordering exposed an unpublished store';
  end if;
end;
$$;
reset role;
set local request.jwt.claims = '{"app_metadata":{"role":"admin"}}';
set local role authenticated;
do $$
declare page jsonb;
begin
  page := public.admin_store_products('c7190001-0000-4000-8000-000000000001');
  if pg_temp.product_ids(page->'products') is distinct from array['order-hidden','order-tie-a','order-tie-b','order-new','order-old','order-manual'] then
    raise exception 'Admin product order differs from the storefront';
  end if;
  page := public.admin_store_products('c7190001-0000-4000-8000-000000000001', 2);
  if pg_temp.product_ids(page->'products') is distinct from array['order-tie-b','order-new','order-old','order-manual'] or page->>'total' <> '6' then
    raise exception 'Product pagination changed the ordering';
  end if;
end;
$$;
reset role;
rollback;
