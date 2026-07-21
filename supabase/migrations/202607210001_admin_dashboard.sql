create or replace function public.admin_dashboard_users()
returns table (
  user_id uuid,
  email text,
  user_created_at timestamptz,
  last_sign_in_at timestamptz,
  store_id uuid,
  store_name text,
  store_slug text,
  store_created_at timestamptz,
  is_published boolean,
  payment_status text,
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
  has_published boolean
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
    store.created_at,
    coalesce(store.is_published, false),
    coalesce(store.payment_status, 'idle'),
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
    coalesce(store.is_published, false)
  from auth.users as users
  left join lateral (
    select selected_store.*
    from public.stores as selected_store
    where selected_store.owner_id = users.id
    order by selected_store.created_at
    limit 1
  ) as store on true
  left join lateral (
    select count(*)::bigint as product_count, max(product.updated_at) as last_updated_at
    from public.products as product
    where product.store_id = store.id
  ) as products on true
  left join lateral (
    select
      count(*)::bigint as order_count,
      coalesce(sum(order_row.product_subtotal) filter (where order_row.status <> 'refunded'), 0) as gross_sales,
      max(order_row.updated_at) as last_created_at
    from public.orders as order_row
    where order_row.store_id = store.id
  ) as orders on true
  order by users.created_at desc;
end;
$$;

revoke all on function public.admin_dashboard_users() from public, anon;
grant execute on function public.admin_dashboard_users() to authenticated;

