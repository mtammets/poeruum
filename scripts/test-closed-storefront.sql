\set ON_ERROR_STOP on
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'closed-store@example.invalid', '{}', '{}', now(), now());
insert into public.stores (id, owner_id, name, slug, is_published, settings) values
('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Suletud pood', 'closed-store-test', false,
'{"editableStoreName":"Minu pood","storeLogo":"https://example.invalid/logo.png","storeTheme":"paper","storeAccent":"#cc6633","contactEmail":"private@example.invalid","businessName":"Privaatne müüja","storeDescription":"Privaatne tutvustus"}'),
('a2000000-0000-4000-8000-000000000002', null, 'Omanikuta pood', 'closed-orphan-test', false, '{}');
insert into public.products (id, store_id, name, image_url, price) values
('closed-store-product', 'a2000000-0000-4000-8000-000000000001', 'Privaatne toode', '/private-product.png', 25);
insert into public.custom_domains (store_id, hostname, redirect_hostname, status) values
('a2000000-0000-4000-8000-000000000001', 'closed.example.invalid', 'www.closed.example.invalid', 'active');

set local role anon;
do $$
declare branding jsonb := public.closed_storefront_branding('  CLOSED-STORE-TEST  ');
begin
  if branding is distinct from '{"name":"Minu pood","logo":"https://example.invalid/logo.png","theme":"paper","accent":"#cc6633"}'::jsonb then
    raise exception 'CLOSED_BRANDING_ALLOWLIST_FAILED: %', branding;
  end if;
  if public.closed_storefront_branding(null, 'CLOSED.EXAMPLE.INVALID.') is distinct from branding
    or public.closed_storefront_branding(null, 'www.closed.example.invalid') is distinct from branding then
    raise exception 'ACTIVE_DOMAIN_BRANDING_FAILED';
  end if;
  if public.closed_storefront_branding() is not null
    or public.closed_storefront_branding('%') is not null
    or public.closed_storefront_branding('missing-shop') is not null
    or public.closed_storefront_branding('closed-orphan-test') is not null
    or public.closed_storefront_branding('closed-store-test', 'closed.example.invalid') is not null then
    raise exception 'CLOSED_BRANDING_LOOKUP_TOO_BROAD';
  end if;
  if exists(select from public.public_storefronts where slug = 'closed-store-test')
    or exists(select from public.products where id = 'closed-store-product')
    or public.storefront_seo_document('closed-store-test') is not null
    or exists(select from jsonb_array_elements(public.storefront_seo_catalog()) entry where entry->>'store_slug' = 'closed-store-test') then
    raise exception 'HIDDEN_STORE_CONTENT_EXPOSED';
  end if;
end $$;
reset role;

update public.custom_domains set status = 'pending_dns' where hostname = 'closed.example.invalid';
set local role anon;
do $$
begin
  if public.closed_storefront_branding(null, 'closed.example.invalid') is not null then
    raise exception 'UNVERIFIED_DOMAIN_BRANDING_EXPOSED';
  end if;
end $$;
reset role;
update public.custom_domains set status = 'active' where hostname = 'closed.example.invalid';
update public.stores set is_published = true where id = 'a2000000-0000-4000-8000-000000000001';
set local role anon;
do $$
begin
  if public.closed_storefront_branding('closed-store-test') is not null
    or public.closed_storefront_branding(null, 'closed.example.invalid') is not null then
    raise exception 'PUBLISHED_STORE_MARKED_CLOSED';
  end if;
end $$;
reset role;
rollback;
