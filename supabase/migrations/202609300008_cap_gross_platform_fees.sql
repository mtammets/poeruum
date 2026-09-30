-- Preserve captured fees; apply both monthly ceilings to new reservations.
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
  grouped_item jsonb;
  product_row public.products%rowtype;
  store_pricing_plan text;
  requested_quantity integer;
  reserved_quantity bigint;
  fee_period_start date;
  reserved_fee_net_cents bigint := 0;
  reserved_fee_gross_cents bigint := 0;
  fee_net_cents integer := 0;
  fee_vat_cents integer := 0;
begin
  if request_id is null or char_length(request_id) < 16 or char_length(request_id) > 100 then
    raise exception 'INVALID_CHECKOUT_REQUEST';
  end if;
  if stripe_mode_value not in ('test', 'live') then
    raise exception 'INVALID_STRIPE_MODE';
  end if;
  if jsonb_typeof(order_items) <> 'array' or jsonb_array_length(order_items) = 0 then
    raise exception 'INVALID_ORDER_ITEMS';
  end if;
  if reservation_expires_at_value is null or reservation_expires_at_value <= now() then
    raise exception 'INVALID_RESERVATION_EXPIRY';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_store_id::text, 0));

  select public.effective_store_pricing_plan(target_store_id)
  into store_pricing_plan;
  if store_pricing_plan is null then raise exception 'STORE_UNAVAILABLE'; end if;

  select * into existing_order
  from public.orders
  where store_id = target_store_id and checkout_request_id = request_id for update;
  if found then
    if existing_order.items <> order_items
      or existing_order.customer_name <> customer_name_value
      or existing_order.customer_email <> customer_email_value
      or existing_order.delivery <> delivery_value
      or existing_order.product_subtotal <> product_subtotal_value
      or existing_order.total <> total_value
      or existing_order.stripe_mode <> stripe_mode_value then
      raise exception 'CHECKOUT_REQUEST_REUSED';
    end if;
    -- An attempt is never reused for another payment, including after a refund.
    return existing_order;
  end if;

  for grouped_item in
    select jsonb_build_object(
      'id', item ->> 'id',
      'quantity', sum(greatest(1, coalesce((item ->> 'quantity')::integer, 1)))
    )
    from jsonb_array_elements(order_items) item
    group by item ->> 'id'
  loop
    requested_quantity := (grouped_item ->> 'quantity')::integer;
    select * into product_row
    from public.products
    where store_id = target_store_id and id = grouped_item ->> 'id'
    for update;

    if not found then raise exception 'PRODUCT_UNAVAILABLE:%', grouped_item ->> 'id'; end if;
    if product_row.stock is not null or product_row.one_of_a_kind then
      select coalesce(sum(greatest(1, (reserved_item ->> 'quantity')::integer)), 0)
      into reserved_quantity
      from public.orders reserved_order
      cross join lateral jsonb_array_elements(reserved_order.items) reserved_item
      where reserved_order.store_id = target_store_id
        and reserved_order.payment_status = 'pending'
        and (
          reserved_order.reservation_expires_at > now()
          or reserved_order.stripe_checkout_session_id is not null
          or reserved_order.stripe_checkout_started_at is not null
        )
        and reserved_item ->> 'id' = product_row.id;

      if requested_quantity + reserved_quantity > (case when product_row.one_of_a_kind then 1 else product_row.stock end) then
        raise exception 'INSUFFICIENT_STOCK:%', product_row.name;
      end if;
    end if;
  end loop;

  fee_period_start := date_trunc('month', now() at time zone 'Europe/Tallinn')::date;
  if store_pricing_plan = 'flexible' then
    select coalesce(sum(candidate.stripe_platform_fee_net_cents), 0),
      coalesce(sum(candidate.stripe_platform_fee_cents), 0)
    into reserved_fee_net_cents, reserved_fee_gross_cents
    from public.orders as candidate
    where candidate.store_id = target_store_id
      and candidate.platform_fee_period_start = fee_period_start
      and candidate.stripe_mode = stripe_mode_value
      and candidate.id is distinct from existing_order.id
      and (
        candidate.payment_status = 'paid'
        or (
          candidate.payment_status = 'pending'
          and (
            candidate.reservation_expires_at > now()
            or candidate.stripe_checkout_session_id is not null
            or candidate.stripe_checkout_started_at is not null
          )
        )
      );

    fee_net_cents := least(
      round(product_subtotal_value * 100 * 0.04)::integer,
      greatest(0, 3900 - reserved_fee_net_cents)::integer,
      -- Largest net fee whose individually rounded 24% VAT still fits the
      -- advertised gross cap. 124*n <= 100*remaining + 49 accounts for
      -- PostgreSQL rounding a half cent upwards (including a 1-cent remainder).
      ((greatest(0, 4836 - reserved_fee_gross_cents) * 100 + 49) / 124)::integer
    );
    fee_vat_cents := round(fee_net_cents * 0.24)::integer;
  end if;

  insert into public.orders (
    store_id, order_number, items, customer_name, customer_email, delivery,
    product_subtotal, total, payment_status, checkout_request_id,
    reservation_expires_at, stripe_mode, stripe_platform_fee_net_cents,
    stripe_platform_fee_vat_cents, stripe_platform_fee_cents,
    platform_fee_period_start
  ) values (
    target_store_id, order_number_value, order_items, customer_name_value,
    customer_email_value, delivery_value, product_subtotal_value, total_value,
    'pending', request_id, reservation_expires_at_value, stripe_mode_value,
    fee_net_cents, fee_vat_cents, fee_net_cents + fee_vat_cents,
    fee_period_start
  ) returning * into created_order;

  return created_order;
end;
$$;

revoke all on function public.create_stripe_order_with_reservation(uuid, text, text, jsonb, text, text, text, numeric, numeric, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_stripe_order_with_reservation(uuid, text, text, jsonb, text, text, text, numeric, numeric, text, timestamptz) to service_role;
