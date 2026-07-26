alter table public.platform_settings
add column if not exists seo_title text not null default 'Poeruum – loo Eesti e-pood 10 minutiga',
add column if not exists seo_description text not null default 'Loo professionaalne e-pood umbes 10 minutiga. Lisa tooted telefonist, võta vastu makseid ning halda tellimusi ja tarnet ühest lihtsast keskkonnast.',
add column if not exists social_title text not null default 'Poeruum – loo Eesti e-pood 10 minutiga',
add column if not exists social_description text not null default 'Loo professionaalne e-pood umbes 10 minutiga.',
add column if not exists search_indexing_enabled boolean not null default true,
add column if not exists seo_updated_at timestamptz not null default now();

alter table public.platform_settings
drop constraint if exists platform_settings_seo_title_length,
drop constraint if exists platform_settings_seo_description_length,
drop constraint if exists platform_settings_social_title_length,
drop constraint if exists platform_settings_social_description_length;

alter table public.platform_settings
add constraint platform_settings_seo_title_length
check (char_length(btrim(seo_title)) between 10 and 70),
add constraint platform_settings_seo_description_length
check (char_length(btrim(seo_description)) between 50 and 200),
add constraint platform_settings_social_title_length
check (char_length(btrim(social_title)) between 10 and 95),
add constraint platform_settings_social_description_length
check (char_length(btrim(social_description)) between 20 and 200);

create or replace function public.admin_set_homepage_seo(
  next_seo_title text,
  next_seo_description text,
  next_social_title text,
  next_social_description text,
  next_search_indexing_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned_seo_title text := btrim(coalesce(next_seo_title, ''));
  cleaned_seo_description text := btrim(coalesce(next_seo_description, ''));
  cleaned_social_title text := btrim(coalesce(next_social_title, ''));
  cleaned_social_description text := btrim(coalesce(next_social_description, ''));
  result jsonb;
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if char_length(cleaned_seo_title) not between 10 and 70
    or char_length(cleaned_seo_description) not between 50 and 200
    or char_length(cleaned_social_title) not between 10 and 95
    or char_length(cleaned_social_description) not between 20 and 200
  then
    raise exception 'Invalid homepage SEO metadata length' using errcode = '22023';
  end if;

  update public.platform_settings
  set seo_title = cleaned_seo_title,
      seo_description = cleaned_seo_description,
      social_title = cleaned_social_title,
      social_description = cleaned_social_description,
      search_indexing_enabled = next_search_indexing_enabled,
      seo_updated_at = now(),
      updated_at = now(),
      updated_by = auth.uid()
  where id = 'homepage'
  returning jsonb_build_object(
    'seo_title', seo_title,
    'seo_description', seo_description,
    'social_title', social_title,
    'social_description', social_description,
    'search_indexing_enabled', search_indexing_enabled,
    'seo_updated_at', seo_updated_at
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_set_homepage_seo(text, text, text, text, boolean) from public, anon;
grant execute on function public.admin_set_homepage_seo(text, text, text, text, boolean) to authenticated;
