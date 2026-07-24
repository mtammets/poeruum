alter table public.platform_settings
add column if not exists social_image_path text;

alter table public.platform_settings
drop constraint if exists platform_settings_social_image_path;

alter table public.platform_settings
add constraint platform_settings_social_image_path
check (
  social_image_path is null
  or social_image_path ~ '^social/[A-Za-z0-9][A-Za-z0-9._-]{0,180}$'
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'platform-assets',
  'platform-assets',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Admins upload platform assets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'platform-assets'
  and (storage.foldername(name))[1] = 'social'
  and (select public.is_admin())
);

create policy "Admins update platform assets"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'platform-assets'
  and (storage.foldername(name))[1] = 'social'
  and (select public.is_admin())
)
with check (
  bucket_id = 'platform-assets'
  and (storage.foldername(name))[1] = 'social'
  and (select public.is_admin())
);

create policy "Admins delete platform assets"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'platform-assets'
  and (storage.foldername(name))[1] = 'social'
  and (select public.is_admin())
);

create or replace function public.admin_set_homepage_social_image(next_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if next_path is not null and next_path !~ '^social/[A-Za-z0-9][A-Za-z0-9._-]{0,180}$' then
    raise exception 'Invalid social image path' using errcode = '22023';
  end if;

  update public.platform_settings
  set social_image_path = next_path,
      updated_at = now(),
      updated_by = auth.uid()
  where id = 'homepage';

  return next_path;
end;
$$;

revoke all on function public.admin_set_homepage_social_image(text) from public, anon;
grant execute on function public.admin_set_homepage_social_image(text) to authenticated;
