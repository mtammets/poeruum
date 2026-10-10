\set ON_ERROR_STOP on
begin;

create temp table directory_visibility_cases (slug text, settings jsonb, published boolean, visible boolean, owner_id uuid default gen_random_uuid());
insert into directory_visibility_cases (slug, settings, published, visible) values
  ('visibility-default', '{}', true, true),
  ('visibility-enabled', '{"directoryVisible":true}', true, true),
  ('visibility-disabled', '{"directoryVisible":false}', true, false),
  ('visibility-null', '{"directoryVisible":null}', true, true),
  ('visibility-draft', '{"directoryVisible":true}', false, true);
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select owner_id, 'authenticated', 'authenticated', slug || '@example.invalid', '{}', '{}', now(), now()
  from directory_visibility_cases;
insert into public.stores (id, owner_id, name, slug, is_published, settings)
  select gen_random_uuid(), owner_id, slug, slug, published, settings from directory_visibility_cases;
grant select on directory_visibility_cases to anon;

create function pg_temp.visible_directory_ids() returns uuid[] language sql as $$
  select coalesce(array_agg((entry ->> 'store_id')::uuid order by ordinal), '{}'::uuid[])
  from jsonb_array_elements(public.storefront_seo_catalog()) with ordinality as catalog(entry, ordinal)
  where (entry -> 'directory_visible') is distinct from 'false'::jsonb;
$$;

set local role anon;
do $$
declare fixture record; entry jsonb; catalog jsonb := public.storefront_seo_catalog();
begin
  for fixture in select * from pg_temp.directory_visibility_cases loop
    select value into entry from jsonb_array_elements(catalog) where value->>'store_slug' = fixture.slug;
    if fixture.published then
      -- Directory opt-out must not remove the public shop from the SEO catalog.
      if entry is null or entry->'directory_visible' is distinct from to_jsonb(fixture.visible) then
        raise exception 'DIRECTORY_VISIBILITY_MISMATCH: %', fixture.slug;
      end if;
      if not exists(select from public.public_storefronts where slug = fixture.slug) then
        raise exception 'DIRECT_STORE_ACCESS_LOST: %', fixture.slug;
      end if;
    elsif entry is not null then
      raise exception 'DRAFT_STORE_EXPOSED';
    end if;
  end loop;
end $$;
reset role;

select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
set local role authenticated;
do $$
declare ids uuid[] := pg_temp.visible_directory_ids(); reversed_ids uuid[];
begin
  select array_agg(id order by ordinal desc) into reversed_ids from unnest(ids) with ordinality as entries(id, ordinal);
  perform public.admin_set_store_directory_order(reversed_ids, ids);
  if pg_temp.visible_directory_ids() is distinct from reversed_ids then raise exception 'VISIBLE_ORDER_NOT_SAVED'; end if;
end $$;
reset role;

-- Turning visibility back on retains publication and makes the shop eligible again.
update public.stores set settings = settings || '{"directoryVisible":true}'::jsonb where slug = 'visibility-disabled';
set local role anon;
do $$
begin
  if not exists(select from public.public_storefronts where slug = 'visibility-disabled' and is_published)
    or not exists(select from jsonb_array_elements(public.storefront_seo_catalog()) as catalog(entry)
      where entry->>'store_slug' = 'visibility-disabled' and entry->'directory_visible' = 'true'::jsonb) then
    raise exception 'REENABLED_STORE_NOT_PUBLIC';
  end if;
end $$;
reset role;
set local role authenticated;
select public.admin_set_store_directory_order(pg_temp.visible_directory_ids(), pg_temp.visible_directory_ids()) is not null as saved_after_reenabling;
reset role;
rollback;
