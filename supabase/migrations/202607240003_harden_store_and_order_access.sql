-- Keep public storefront data separate from merchant and billing data.
-- The base stores table contains Stripe identifiers, subscription state and
-- private notification settings, so it must never be readable by anon users.

drop policy if exists "Published stores are public" on public.stores;

create policy "Owners read stores"
on public.stores
for select
to authenticated
using (owner_id = (select auth.uid()));

create or replace function public.is_store_public(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stores
    where id = target_store_id
      and is_published = true
  );
$$;

revoke all on function public.is_store_public(uuid) from public;
grant execute on function public.is_store_public(uuid) to anon, authenticated;

drop policy if exists "Published products are public" on public.products;

create policy "Published products are public"
on public.products
for select
to anon, authenticated
using (
  (select public.is_store_public(store_id))
  or (select public.is_store_owner(store_id))
);

drop view if exists public.public_storefronts;
create view public.public_storefronts
with (security_barrier = true)
as
select
  stores.id,
  stores.name,
  stores.slug,
  stores.is_published,
  stores.payment_provider,
  case
    when stores.payment_status = 'connected'
      and stores.stripe_account_charges_enabled
      and stores.stripe_account_payouts_enabled
    then 'connected'
    else 'idle'
  end as payment_status,
  stores.shipping,
  stores.settings - array[
    'activePaymentProvider',
    'billingPlan',
    'customerConfirmations',
    'onboardingStep',
    'orderNotificationEmail',
    'sellerNotifications'
  ]::text[] as settings
from public.stores
where stores.is_published = true;

revoke all on table public.public_storefronts from public;
grant select on table public.public_storefronts to anon, authenticated;

-- Merchants may create and edit storefront content, but billing, Stripe and
-- payment-state columns are service-owned.
revoke all on table public.stores from anon;
revoke insert, update, delete on table public.stores from authenticated;

grant select on table public.stores to authenticated;
grant insert (
  owner_id,
  name,
  slug,
  is_published,
  payment_provider,
  shipping,
  settings
) on public.stores to authenticated;
grant update (
  name,
  slug,
  is_published,
  payment_provider,
  shipping,
  settings
) on public.stores to authenticated;

-- Order financial and payment columns are immutable from the browser. The
-- only direct merchant transition is a paid order from new to fulfilled.
revoke update on table public.orders from authenticated;

create or replace function public.mark_order_fulfilled(
  target_store_id uuid,
  target_order_number text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_allowed boolean;
  affected_rows integer;
begin
  select exists (
    select 1
    from public.stores
    where id = target_store_id
      and (
        owner_id = (select auth.uid())
        or (
          id = '00000000-0000-4000-8000-000000000001'
          and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin'
        )
      )
  ) into is_allowed;

  if not is_allowed then
    raise exception 'ORDER_ACCESS_DENIED' using errcode = '42501';
  end if;

  update public.orders
  set status = 'fulfilled'
  where store_id = target_store_id
    and order_number = target_order_number
    and status = 'new'
    and payment_status = 'paid';

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'ORDER_NOT_FULFILLABLE' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.mark_order_fulfilled(uuid, text) from public, anon;
grant execute on function public.mark_order_fulfilled(uuid, text) to authenticated;

comment on view public.public_storefronts is
  'Public storefront projection without owner, Stripe, subscription or private notification data.';
comment on function public.mark_order_fulfilled(uuid, text) is
  'Allows a store owner to mark only a paid new order as fulfilled.';

-- Fail the migration if a later grant above accidentally leaves a critical
-- privilege open.
do $$
begin
  if has_table_privilege('anon', 'public.stores', 'SELECT') then
    raise exception 'ACCESS_ASSERTION_FAILED: anon can select stores';
  end if;
  if not has_table_privilege('anon', 'public.public_storefronts', 'SELECT') then
    raise exception 'ACCESS_ASSERTION_FAILED: anon cannot select public storefronts';
  end if;
  if has_column_privilege('authenticated', 'public.stores', 'pricing_plan', 'UPDATE')
    or has_column_privilege('authenticated', 'public.stores', 'payment_status', 'UPDATE')
    or has_column_privilege('authenticated', 'public.stores', 'stripe_account_id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.stores', 'stripe_subscription_status', 'UPDATE') then
    raise exception 'ACCESS_ASSERTION_FAILED: authenticated can update a service-owned store column';
  end if;
  if has_table_privilege('authenticated', 'public.orders', 'UPDATE') then
    raise exception 'ACCESS_ASSERTION_FAILED: authenticated can update orders directly';
  end if;
end;
$$;
