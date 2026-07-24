alter table public.stores
  add column if not exists deleted_at timestamptz;

alter table public.stores
  drop constraint if exists stores_owner_id_fkey;

alter table public.stores
  add constraint stores_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete set null;

create table if not exists public.external_resource_cleanup (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe')),
  resource_type text not null check (resource_type in ('connected_account', 'customer')),
  resource_id text not null,
  mode text check (mode in ('test', 'live')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'skipped')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (provider, resource_type, resource_id)
);

create index if not exists external_resource_cleanup_pending_idx
  on public.external_resource_cleanup(created_at)
  where status = 'pending';

alter table public.external_resource_cleanup enable row level security;
revoke all on table public.external_resource_cleanup from public, anon, authenticated;
grant select, insert, update, delete on table public.external_resource_cleanup to service_role;

drop trigger if exists external_resource_cleanup_updated_at on public.external_resource_cleanup;
create trigger external_resource_cleanup_updated_at
before update on public.external_resource_cleanup
for each row execute function public.set_updated_at();

create or replace function public.handle_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Operational email logs are not accounting records and contain the user's address.
  if old.email is not null then
    delete from public.email_deliveries
    where lower(recipient_email) = lower(old.email::text);
  end if;

  -- Product data is not retained after account deletion. Orders and revenue events
  -- may be accounting records, so their store is retained as an anonymous tombstone.
  delete from public.products
  where store_id in (select id from public.stores where owner_id = old.id);

  delete from public.custom_domains
  where store_id in (select id from public.stores where owner_id = old.id);

  delete from public.stores as store
  where store.owner_id = old.id
    and not exists (select 1 from public.orders as orders where orders.store_id = store.id)
    and not exists (select 1 from public.revenue_events as event where event.store_id = store.id);

  update public.stores
  set
    owner_id = null,
    name = 'Kustutatud pood',
    slug = 'deleted-' || id::text,
    is_published = false,
    payment_provider = 'stripe',
    payment_status = 'idle',
    pricing_plan = 'flexible',
    trial_started_at = null,
    shipping = '{}'::text[],
    settings = '{}'::jsonb,
    stripe_account_id = null,
    stripe_account_charges_enabled = false,
    stripe_account_payouts_enabled = false,
    stripe_customer_id = null,
    stripe_subscription_id = null,
    stripe_subscription_status = null,
    stripe_account_mode = null,
    stripe_billing_mode = null,
    deleted_at = now()
  where owner_id = old.id;

  return old;
end;
$$;

revoke all on function public.handle_account_deletion() from public, anon, authenticated;

drop trigger if exists safely_remove_account_data on auth.users;
create trigger safely_remove_account_data
before delete on auth.users
for each row execute function public.handle_account_deletion();

do $$
begin
  if has_table_privilege('anon', 'public.external_resource_cleanup', 'SELECT')
    or has_table_privilege('authenticated', 'public.external_resource_cleanup', 'SELECT')
  then
    raise exception 'External cleanup queue must not be readable by application roles';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'stores_owner_id_fkey'
      and confdeltype <> 'n'
  ) then
    raise exception 'stores.owner_id must use ON DELETE SET NULL';
  end if;
end
$$;
