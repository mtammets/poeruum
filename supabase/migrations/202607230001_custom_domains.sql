create table public.custom_domains (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  hostname text not null,
  redirect_hostname text unique,
  status text not null default 'pending_dns'
    check (status in ('pending_dns', 'verifying', 'active', 'error')),
  provider text not null default 'render'
    check (provider in ('render')),
  provider_domain_id text,
  provider_redirect_domain_id text,
  provider_verification_status text
    check (provider_verification_status is null or provider_verification_status in ('verified', 'unverified')),
  domain_type text
    check (domain_type is null or domain_type in ('apex', 'subdomain')),
  public_suffix text,
  dns_record_type text,
  dns_record_name text,
  dns_record_value text,
  last_error text,
  dns_verified_at timestamptz,
  tls_verified_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_domains_hostname_normalized
    check (
      hostname = lower(hostname)
      and hostname = btrim(hostname)
      and char_length(hostname) between 4 and 253
      and hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    ),
  constraint custom_domains_not_poeruum
    check (
      hostname <> 'poeruum.ee'
      and hostname not like '%.poeruum.ee'
      and (
        redirect_hostname is null
        or (
          redirect_hostname = lower(redirect_hostname)
          and redirect_hostname = btrim(redirect_hostname)
          and char_length(redirect_hostname) between 4 and 253
          and redirect_hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
          and redirect_hostname <> 'poeruum.ee'
          and redirect_hostname not like '%.poeruum.ee'
        )
      )
    ),
  unique (store_id),
  unique (hostname)
);

create index custom_domains_active_hostname_idx
  on public.custom_domains(hostname)
  where status = 'active';

create trigger custom_domains_updated_at
  before update on public.custom_domains
  for each row execute function public.set_updated_at();

alter table public.custom_domains enable row level security;

grant select on public.custom_domains to authenticated;
grant all on public.custom_domains to service_role;

create policy "Owners read custom domains"
  on public.custom_domains
  for select
  to authenticated
  using ((select public.is_store_owner(store_id)));

create or replace function public.resolve_store_slug_for_hostname(requested_hostname text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.slug
  from public.custom_domains d
  join public.stores s on s.id = d.store_id
  where (
      d.hostname = lower(rtrim(btrim(requested_hostname), '.'))
      or d.redirect_hostname = lower(rtrim(btrim(requested_hostname), '.'))
    )
    and d.status = 'active'
    and s.is_published
  limit 1;
$$;

revoke all on function public.resolve_store_slug_for_hostname(text) from public;
grant execute on function public.resolve_store_slug_for_hostname(text) to anon, authenticated;

comment on table public.custom_domains is
  'Verified customer-owned hostnames routed to published Poeruum stores.';
comment on function public.resolve_store_slug_for_hostname(text) is
  'Resolves only active custom domains belonging to published stores without exposing the domain registry.';
