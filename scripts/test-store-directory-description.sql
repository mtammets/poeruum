\set ON_ERROR_STOP on
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('95000000-0000-4000-8000-000000000020', 'authenticated', 'authenticated', 'directory-description@example.invalid', '{}', '{}', now(), now());

create temp table directory_description_cases (slug text, settings jsonb, expected text);
insert into directory_description_cases values
  ('description-specific', '{"directoryDescription":"  Kaubamaja tutvustus.  ","storeDescription":"Poe tutvustus.","seoDescription":"SEO tekst."}', 'Kaubamaja tutvustus.'),
  ('description-empty-seo', '{"directoryDescription":"","storeDescription":"Kaupmehe kirjutatud tutvustus.","seoDescription":""}', 'Kaupmehe kirjutatud tutvustus.'),
  ('description-missing-seo', '{"storeDescription":"Poe tutvustus."}', 'Poe tutvustus.'),
  ('description-prefer-intro', '{"storeDescription":"Poe tutvustus.","seoDescription":"SEO tekst."}', 'Poe tutvustus.'),
  ('description-whitespace', '{"directoryDescription":" \t\n ","storeDescription":"  Poe\n tutvustus.  ","seoDescription":"SEO tekst."}', 'Poe tutvustus.'),
  ('description-seo-only', '{"seoDescription":"SEO tekst."}', ''),
  ('description-blank-intro', '{"directoryDescription":" \n","storeDescription":"\t ","seoDescription":"SEO tekst."}', ''),
  ('description-null', '{"directoryDescription":null,"storeDescription":null,"seoDescription":null}', ''),
  ('description-missing', '{}', '');
insert into public.stores (id, owner_id, name, slug, is_published, settings)
  select gen_random_uuid(), '95000000-0000-4000-8000-000000000020', slug, slug, true, settings
  from directory_description_cases;
grant select on directory_description_cases to anon;

set local role anon;
do $$
declare fixture record; entry jsonb; catalog jsonb := public.storefront_seo_catalog();
begin
  for fixture in select * from pg_temp.directory_description_cases loop
    select value into entry from jsonb_array_elements(catalog) where value->>'store_slug' = fixture.slug;
    if entry is null or entry->>'directory_description' is distinct from fixture.expected then
      raise exception 'DIRECTORY_DESCRIPTION_MISMATCH: %, expected %, got %', fixture.slug, fixture.expected, entry->>'directory_description';
    end if;
    -- This catalog also drives SEO assets; the directory fix must preserve that contract.
    if entry->>'store_description' is distinct from coalesce(fixture.settings->>'seoDescription', fixture.settings->>'storeDescription', '') then
      raise exception 'SEO_DESCRIPTION_CHANGED: %', fixture.slug;
    end if;
  end loop;
end $$;
reset role;
rollback;
