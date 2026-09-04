-- Preserve only Stripe's machine-readable requirement error code and field.
-- Raw provider messages and uploaded document contents are intentionally not stored.
alter table public.stores
  add column if not exists stripe_account_requirement_issues jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(stripe_account_requirement_issues) = 'array'
      and jsonb_array_length(stripe_account_requirement_issues) <= 10
    );

revoke update (stripe_account_requirement_issues)
on table public.stores from authenticated;

comment on column public.stores.stripe_account_requirement_issues is
  'Sanitized Stripe requirement error codes and field paths; never raw provider messages or document contents.';

create or replace function public.clear_stripe_requirement_issues_on_disconnect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stripe_account_id is null then
    new.stripe_account_requirement_issues = '[]'::jsonb;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_stripe_requirement_issues_on_disconnect()
from public, anon, authenticated;

drop trigger if exists stores_clear_stripe_requirement_issues_on_disconnect on public.stores;
create trigger stores_clear_stripe_requirement_issues_on_disconnect
before update of stripe_account_id on public.stores
for each row
when (new.stripe_account_id is null)
execute function public.clear_stripe_requirement_issues_on_disconnect();

-- Surface the same safe issue details in the administrator user overview so
-- support can understand the state without looking up the Stripe account.
drop function if exists public.admin_dashboard_users();

create function public.admin_dashboard_users()
returns table (
  user_id uuid,
  email text,
  user_created_at timestamptz,
  last_sign_in_at timestamptz,
  store_id uuid,
  store_name text,
  store_slug text,
  custom_hostname text,
  store_created_at timestamptz,
  is_published boolean,
  payment_status text,
  stripe_account_requirement_issues jsonb,
  pricing_plan text,
  product_count bigint,
  order_count bigint,
  gross_sales numeric,
  last_activity_at timestamptz,
  has_store_details boolean,
  has_payments boolean,
  has_delivery boolean,
  has_product boolean,
  has_business_details boolean,
  has_published boolean,
  open_support_count bigint,
  last_support_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select
    users.id,
    users.email::text,
    users.created_at,
    users.last_sign_in_at,
    store.id,
    store.name,
    store.slug,
    custom_domain.hostname,
    store.created_at,
    coalesce(store.is_published, false),
    coalesce(store.payment_status, 'idle'),
    coalesce(store.stripe_account_requirement_issues, '[]'::jsonb),
    coalesce(store.pricing_plan, 'flexible'),
    coalesce(products.product_count, 0),
    coalesce(orders.order_count, 0),
    coalesce(orders.gross_sales, 0),
    greatest(users.last_sign_in_at, store.updated_at, products.last_updated_at, orders.last_created_at),
    coalesce(nullif(btrim(store.name), '') is not null, false),
    coalesce(store.payment_status = 'connected', false),
    coalesce(cardinality(store.shipping) > 0, false),
    coalesce(products.product_count > 0, false),
    coalesce(
      nullif(btrim(store.settings ->> 'businessName'), '') is not null
      and (store.settings ->> 'registryCode') ~ '^\d{8}$'
      and nullif(btrim(store.settings ->> 'businessAddress'), '') is not null
      and nullif(btrim(store.settings ->> 'contactEmail'), '') is not null,
      false
    ),
    coalesce(store.is_published, false),
    coalesce(support.open_count, 0),
    support.last_support_at
  from auth.users users
  left join lateral (
    select selected_store.*
    from public.stores selected_store
    where selected_store.owner_id = users.id
    order by selected_store.created_at
    limit 1
  ) store on true
  left join lateral (
    select domain.hostname
    from public.custom_domains domain
    where domain.store_id = store.id
      and domain.status = 'active'
    limit 1
  ) custom_domain on true
  left join lateral (
    select count(*)::bigint product_count, max(product.updated_at) last_updated_at
    from public.products product
    where product.store_id = store.id
  ) products on true
  left join lateral (
    select
      count(*)::bigint order_count,
      coalesce(sum(order_row.product_subtotal) filter (where order_row.status <> 'refunded'), 0) gross_sales,
      max(order_row.updated_at) last_created_at
    from public.orders order_row
    where order_row.store_id = store.id
  ) orders on true
  left join lateral (
    select
      count(*) filter (where conversation.status <> 'resolved')::bigint open_count,
      max(conversation.last_message_at) last_support_at
    from public.support_conversations conversation
    where conversation.user_id = users.id
  ) support on true
  where coalesce(users.raw_app_meta_data ->> 'role', '') <> 'admin'
  order by users.created_at desc;
end;
$$;

revoke all on function public.admin_dashboard_users() from public, anon;
grant execute on function public.admin_dashboard_users() to authenticated;

comment on function public.admin_dashboard_users() is
  'Returns merchant setup, activity and sanitized Stripe issue data to platform administrators.';

do $$
begin
  if has_column_privilege('authenticated', 'public.stores', 'stripe_account_requirement_issues', 'UPDATE') then
    raise exception 'ACCESS_ASSERTION_FAILED: authenticated can update Stripe requirement issues';
  end if;
end;
$$;
