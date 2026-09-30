\set ON_ERROR_STOP on
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('95000000-0000-4000-8000-000000000030', 'authenticated', 'authenticated', 'homepage-showcase@example.invalid', '{}', '{}', now(), now()),
  ('95000000-0000-4000-8000-000000000032', 'authenticated', 'authenticated', 'homepage-draft@example.invalid', '{}', '{}', now(), now());
insert into public.stores (id, owner_id, name, slug, is_published) values
  ('96000000-0000-4000-8000-000000000031', '95000000-0000-4000-8000-000000000030', 'Preview first', 'preview-first', true),
  ('96000000-0000-4000-8000-000000000032', '95000000-0000-4000-8000-000000000032', 'Preview draft', 'preview-draft', false),
  ('96000000-0000-4000-8000-000000000033', null, 'Preview ownerless', 'preview-ownerless', true);
insert into public.products (id, store_id, name, image_url, price, stock, search_visible) values
  ('preview-good', '96000000-0000-4000-8000-000000000031', 'Good', 'https://example.supabase.co/storage/v1/object/public/product-images/good.webp', 10, 2, true),
  ('preview-sold', '96000000-0000-4000-8000-000000000031', 'Sold', 'https://example.supabase.co/storage/v1/object/public/product-images/sold.webp', 10, 0, true),
  ('preview-hidden', '96000000-0000-4000-8000-000000000031', 'Hidden', 'https://example.supabase.co/storage/v1/object/public/product-images/hidden.webp', 10, 2, false),
  ('preview-no-price', '96000000-0000-4000-8000-000000000031', 'No price', 'https://example.supabase.co/storage/v1/object/public/product-images/none.webp', null, 2, true);

set local role anon;
do $$ begin
  perform homepage_store_ids from public.platform_settings where id = 'homepage';
  begin
    perform public.admin_homepage_showcase();
    raise exception 'ANONYMOUS_ADMIN_READ_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_set_homepage_showcase('{}', '{}');
    raise exception 'ANONYMOUS_SAVE_ALLOWED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000030","app_metadata":{},"user_metadata":{"role":"admin"}}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.admin_homepage_showcase();
    raise exception 'MERCHANT_ADMIN_READ_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_set_homepage_showcase('{}', '{}');
    raise exception 'MERCHANT_SAVE_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin
    update public.platform_settings set homepage_store_ids = '{}' where id = 'homepage';
    raise exception 'DIRECT_SETTINGS_WRITE_ALLOWED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"95000000-0000-4000-8000-000000000030","app_metadata":{"role":"admin"}}', true);
set local role authenticated;
do $$
declare
  initial_ids uuid[];
  result jsonb;
  first_id uuid := '96000000-0000-4000-8000-000000000031';
  draft_id uuid := '96000000-0000-4000-8000-000000000032';
  invalid uuid[];
begin
  select homepage_store_ids into initial_ids from public.platform_settings where id = 'homepage';
  result := public.admin_homepage_showcase();
  if not exists (select 1 from jsonb_array_elements(result->'stores') s
    where s->>'id' = first_id::text and (s->>'eligibleProductCount')::integer = 1)
    or not exists (select 1 from jsonb_array_elements(result->'stores') s
      where s->>'id' = draft_id::text and not (s->>'isPublished')::boolean)
    or exists (select 1 from jsonb_array_elements(result->'stores') s where s->>'slug' = 'preview-ownerless') then
    raise exception 'INVALID_ADMIN_CANDIDATES';
  end if;
  result := public.admin_set_homepage_showcase(array[first_id, draft_id], initial_ids);
  if result->'selectedStoreIds' is distinct from to_jsonb(array[first_id, draft_id]) then
    raise exception 'SELECTION_NOT_SAVED';
  end if;
  begin
    perform public.admin_set_homepage_showcase(array[first_id], initial_ids);
    raise exception 'STALE_SAVE_ALLOWED';
  exception when serialization_failure then null; end;
  foreach invalid slice 1 in array array[
    array[first_id, first_id], array[first_id, null],
    array[first_id, '96000000-0000-4000-8000-000000000033'::uuid],
    array[first_id, '96000000-0000-4000-8000-000000000099'::uuid]
  ] loop
    begin
      perform public.admin_set_homepage_showcase(invalid, array[first_id, draft_id]);
      raise exception 'INVALID_SELECTION_ALLOWED';
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.admin_set_homepage_showcase('{}', array[first_id, draft_id]);
    raise exception 'EMPTY_SELECTION_ALLOWED';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
rollback;
