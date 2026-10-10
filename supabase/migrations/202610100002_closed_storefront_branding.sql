-- A hidden storefront may identify itself without exposing its content.
-- Keep the published-store views, SEO APIs and product RLS unchanged.
create or replace function public.closed_storefront_branding(requested_slug text default null, requested_hostname text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', coalesce(nullif(btrim(s.settings ->> 'editableStoreName'), ''), s.name),
    'logo', s.settings ->> 'storeLogo',
    'theme', s.settings ->> 'storeTheme',
    'accent', s.settings ->> 'storeAccent'
  )
  from public.stores s
  where not s.is_published
    and s.owner_id is not null
    and lower(s.slug) not in ('test', 'kaubamaja')
    and (
      (requested_hostname is null and s.slug = lower(btrim(requested_slug)))
      or (requested_slug is null and exists (
        select 1 from public.custom_domains d
        where d.store_id = s.id and d.status = 'active'
          and (d.hostname = lower(rtrim(btrim(requested_hostname), '.'))
            or d.redirect_hostname = lower(rtrim(btrim(requested_hostname), '.')))
      ))
    )
  limit 1;
$$;

revoke all on function public.closed_storefront_branding(text, text) from public;
grant execute on function public.closed_storefront_branding(text, text) to anon, authenticated;
comment on function public.closed_storefront_branding(text, text) is
  'Exact lookup of a hidden shop: only its name, logo, theme and accent. No products, contacts, seller settings or identifiers.';
