-- Published storefronts, search previews and order emails need stable image
-- URLs, so the bucket remains public. Object metadata must still not be
-- enumerable: draft assets use random paths and are only disclosed to their
-- owner until the store is published.

drop policy if exists "Public product images" on storage.objects;

drop policy if exists "Owners read own product images" on storage.objects;
create policy "Owners read own product images"
on storage.objects for select to authenticated
using (
  bucket_id = 'product-images'
  and (select public.is_store_owner((storage.foldername(name))[1]::uuid))
);

drop policy if exists "Admins read demo product images" on storage.objects;
create policy "Admins read demo product images"
on storage.objects for select to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = '00000000-0000-4000-8000-000000000001'
  and (select public.is_admin())
);

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'product-images'
      and public
  ) then
    raise exception 'ACCESS_ASSERTION_FAILED: product image bucket must serve stable public URLs';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public product images'
  ) then
    raise exception 'ACCESS_ASSERTION_FAILED: product image metadata remains publicly listable';
  end if;
end;
$$;
