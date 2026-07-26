create table public.product_url_history (
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id text,
  old_slug text not null,
  new_slug text,
  status text not null check (status in ('redirect', 'gone')),
  created_at timestamptz not null default now(),
  primary key (store_id, old_slug)
);

alter table public.product_url_history enable row level security;
revoke all on table public.product_url_history from public, anon, authenticated;
grant all on table public.product_url_history to service_role;

create or replace function public.remember_product_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_slug text;
  next_slug text;
begin
  previous_slug := coalesce(nullif(old.slug, ''), old.id);

  if tg_op = 'DELETE' then
    insert into public.product_url_history (store_id, product_id, old_slug, new_slug, status)
    values (old.store_id, old.id, previous_slug, null, 'gone')
    on conflict (store_id, old_slug) do update
      set product_id = excluded.product_id,
          new_slug = null,
          status = 'gone',
          created_at = now();
    return old;
  end if;

  next_slug := coalesce(nullif(new.slug, ''), new.id);
  if previous_slug <> next_slug then
    insert into public.product_url_history (store_id, product_id, old_slug, new_slug, status)
    values (new.store_id, new.id, previous_slug, next_slug, 'redirect')
    on conflict (store_id, old_slug) do update
      set product_id = excluded.product_id,
          new_slug = excluded.new_slug,
          status = 'redirect',
          created_at = now();
  end if;
  return new;
end;
$$;

create trigger remember_product_url_on_update
  before update of slug on public.products
  for each row execute function public.remember_product_url();

create trigger remember_product_url_on_delete
  before delete on public.products
  for each row execute function public.remember_product_url();

create or replace function public.storefront_seo_document(requested_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'store_id', s.id,
    'store_name', s.name,
    'store_slug', s.slug,
    'store_updated_at', s.updated_at,
    'settings', s.settings,
    'shipping', s.shipping,
    'primary_hostname', coalesce((
      select d.hostname
      from public.custom_domains d
      where d.store_id = s.id and d.status = 'active'
      limit 1
    ), s.slug || '.poeruum.ee'),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'slug', coalesce(nullif(p.slug, ''), p.id),
          'description', coalesce(p.description, ''),
          'seo_title', coalesce(nullif(p.seo_title, ''), p.name || ' – ' || s.name),
          'image_url', p.image_url,
          'gallery', p.gallery,
          'alt', coalesce(nullif(p.alt, ''), p.name),
          'price', p.price,
          'sale_price', p.sale_price,
          'stock', p.stock,
          'one_of_a_kind', p.one_of_a_kind,
          'options', p.options,
          'search_visible', p.search_visible,
          'updated_at', p.updated_at
        )
        order by p.sort_order, p.created_at
      )
      from public.products p
      where p.store_id = s.id
    ), '[]'::jsonb),
    'url_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'old_slug', h.old_slug,
        'new_slug', h.new_slug,
        'status', h.status
      ))
      from public.product_url_history h
      where h.store_id = s.id
    ), '[]'::jsonb)
  )
  from public.stores s
  where s.slug = lower(btrim(requested_slug))
    and s.is_published = true
    and s.owner_id is not null
  limit 1;
$$;

revoke all on function public.storefront_seo_document(text) from public;
grant execute on function public.storefront_seo_document(text) to anon, authenticated;

comment on function public.storefront_seo_document(text) is
  'Returns the public, request-time SEO document for one published merchant storefront.';
