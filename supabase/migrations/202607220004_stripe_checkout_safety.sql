alter table public.stores
  add column if not exists stripe_account_mode text check (stripe_account_mode in ('test', 'live')),
  add column if not exists stripe_billing_mode text check (stripe_billing_mode in ('test', 'live'));

alter table public.orders
  add column if not exists checkout_request_id text,
  add column if not exists reservation_expires_at timestamptz,
  add column if not exists stripe_mode text check (stripe_mode in ('test', 'live'));

create unique index if not exists orders_store_checkout_request_idx
  on public.orders(store_id, checkout_request_id)
  where checkout_request_id is not null;

create index if not exists orders_active_reservations_idx
  on public.orders(store_id, reservation_expires_at)
  where payment_status = 'pending';

create or replace function public.create_stripe_order_with_reservation(
  target_store_id uuid,
  request_id text,
  order_number_value text,
  order_items jsonb,
  customer_name_value text,
  customer_email_value text,
  delivery_value text,
  product_subtotal_value numeric,
  total_value numeric,
  stripe_mode_value text,
  reservation_expires_at_value timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_order public.orders%rowtype;
  created_order public.orders%rowtype;
  order_item jsonb;
  product_row public.products%rowtype;
  requested_quantity integer;
  reserved_quantity bigint;
  renew_existing boolean := false;
begin
  if request_id is null or char_length(request_id) < 16 or char_length(request_id) > 100 then
    raise exception 'INVALID_CHECKOUT_REQUEST';
  end if;
  if stripe_mode_value not in ('test', 'live') then
    raise exception 'INVALID_STRIPE_MODE';
  end if;

  -- Serialise reservations per store so two buyers cannot reserve the same last item.
  perform pg_advisory_xact_lock(hashtextextended(target_store_id::text, 0));

  select * into existing_order
  from public.orders
  where store_id = target_store_id and checkout_request_id = request_id;
  if found then
    if existing_order.payment_status in ('pending', 'paid') then return existing_order; end if;
    renew_existing := true;
  end if;

  for order_item in select * from jsonb_array_elements(order_items)
  loop
    requested_quantity := greatest(1, coalesce((order_item ->> 'quantity')::integer, 1));
    select * into product_row
    from public.products
    where store_id = target_store_id and id = order_item ->> 'id'
    for update;

    if not found then raise exception 'PRODUCT_UNAVAILABLE:%', order_item ->> 'id'; end if;
    if product_row.stock is not null or product_row.one_of_a_kind then
      select coalesce(sum(greatest(1, (reserved_item ->> 'quantity')::integer)), 0)
      into reserved_quantity
      from public.orders reserved_order
      cross join lateral jsonb_array_elements(reserved_order.items) reserved_item
      where reserved_order.store_id = target_store_id
        and reserved_order.payment_status = 'pending'
        and reserved_order.reservation_expires_at > now()
        and reserved_item ->> 'id' = product_row.id;

      if requested_quantity + reserved_quantity > (case when product_row.one_of_a_kind then 1 else product_row.stock end) then
        raise exception 'INSUFFICIENT_STOCK:%', product_row.name;
      end if;
    end if;
  end loop;

  if renew_existing then
    update public.orders
    set payment_status = 'pending', reservation_expires_at = reservation_expires_at_value
    where id = existing_order.id
    returning * into created_order;
    return created_order;
  end if;

  insert into public.orders (
    store_id, order_number, items, customer_name, customer_email, delivery,
    product_subtotal, total, payment_status, checkout_request_id,
    reservation_expires_at, stripe_mode
  ) values (
    target_store_id, order_number_value, order_items, customer_name_value,
    customer_email_value, delivery_value, product_subtotal_value, total_value,
    'pending', request_id, reservation_expires_at_value, stripe_mode_value
  ) returning * into created_order;

  return created_order;
end;
$$;

create or replace function public.release_stripe_order(target_order_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.orders
  set payment_status = 'failed', reservation_expires_at = null
  where id = target_order_id and payment_status = 'pending';
$$;

create or replace function public.complete_stripe_order(
  target_order_id uuid,
  checkout_session_id text,
  payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  order_item jsonb;
  item_quantity integer;
begin
  select * into target from public.orders where id = target_order_id for update;
  if not found or target.payment_status = 'paid' then return; end if;

  update public.orders
  set payment_status = 'paid', reservation_expires_at = null,
      stripe_checkout_session_id = checkout_session_id,
      stripe_payment_intent_id = payment_intent_id
  where id = target_order_id;

  for order_item in select * from jsonb_array_elements(target.items)
  loop
    item_quantity := greatest(1, coalesce((order_item ->> 'quantity')::integer, 1));
    update public.products
    set stock = greatest(0, stock - item_quantity)
    where store_id = target.store_id and id = order_item ->> 'id' and stock is not null;
  end loop;
end;
$$;

revoke all on function public.create_stripe_order_with_reservation(uuid, text, text, jsonb, text, text, text, numeric, numeric, text, timestamptz) from public, anon, authenticated;
revoke all on function public.release_stripe_order(uuid) from public, anon, authenticated;
revoke all on function public.complete_stripe_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_stripe_order_with_reservation(uuid, text, text, jsonb, text, text, text, numeric, numeric, text, timestamptz) to service_role;
grant execute on function public.release_stripe_order(uuid) to service_role;
grant execute on function public.complete_stripe_order(uuid, text, text) to service_role;
