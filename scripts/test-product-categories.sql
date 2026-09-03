\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('75000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'category-owner@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('75000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'category-other@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('75000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'category-admin@example.invalid', '{"role":"admin"}'::jsonb, '{}'::jsonb, now(), now());

insert into public.stores (id, owner_id, name, slug, is_published, shipping, settings) values
  ('76000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000001', 'Private category store', 'private-category-store', false, '{}'::text[], '{}'::jsonb),
  ('76000000-0000-4000-8000-000000000002', '75000000-0000-4000-8000-000000000002', 'Public category store', 'public-category-store', true, '{}'::text[], '{}'::jsonb);

select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"75000000-0000-4000-8000-000000000001","app_metadata":{}}', true);
set local role authenticated;

insert into public.product_categories (id, store_id, name, slug)
values ('77000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001', 'Ehted', 'ehted');

do $$
begin
  if not exists (select 1 from public.product_categories where slug = 'ehted') then
    raise exception 'TEST_OWNER_CANNOT_CREATE_OR_READ_CATEGORY';
  end if;
end;
$$;

reset role;
set local role anon;

do $$
begin
  if exists (select 1 from public.product_categories where slug = 'ehted') then
    raise exception 'TEST_ANONYMOUS_CAN_READ_PRIVATE_CATEGORY';
  end if;
end;
$$;

reset role;

insert into public.product_categories (id, store_id, name, slug)
values ('77000000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000002', 'Kodu', 'kodu');

set local role anon;

do $$
begin
  if not exists (select 1 from public.product_categories where slug = 'kodu') then
    raise exception 'TEST_ANONYMOUS_CANNOT_READ_PUBLIC_CATEGORY';
  end if;
end;
$$;

reset role;

do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.products (id, store_id, category_id, name, image_url)
    values ('category-cross-store-product', '76000000-0000-4000-8000-000000000002', '77000000-0000-4000-8000-000000000001', 'Wrong category', 'https://example.invalid/product.webp');
  exception when check_violation then
    rejected := true;
  end;

  if not rejected then
    raise exception 'TEST_CROSS_STORE_CATEGORY_ACCEPTED';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"75000000-0000-4000-8000-000000000003","app_metadata":{"role":"admin"}}', true);
set local role authenticated;

insert into public.product_categories (store_id, name, slug)
values ('00000000-0000-4000-8000-000000000001', 'Näidiskategooria', 'naidiskategooria');

rollback;
