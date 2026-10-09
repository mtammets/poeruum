-- Read-only photo preview for administrators, including unpublished stores.
create function public.admin_store_products(target_store_id uuid, page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if coalesce((select auth.jwt()->'app_metadata'->>'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if page_offset is null or page_offset < 0 then
    raise exception 'Invalid offset' using errcode = '22023';
  end if;
  if not exists (select from public.stores where id = target_store_id) then
    raise exception 'Store not found' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'version', 1, 'store_id', target_store_id, 'offset', page_offset,
    'total', (select count(*) from public.products where store_id = target_store_id),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'image_url', p.image_url, 'gallery', p.gallery, 'alt', p.alt
    ) order by p.sort_order, p.created_at, p.id) from (
      select id, name, image_url, gallery, alt, sort_order, created_at
      from public.products where store_id = target_store_id
      order by sort_order, created_at, id limit 48 offset page_offset
    ) p), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_store_products(uuid, integer) from public, anon;
grant execute on function public.admin_store_products(uuid, integer) to authenticated;
comment on function public.admin_store_products(uuid, integer) is
  'Admin-only product image preview. Returns at most 48 products in storefront order; does not change products or store publication.';
