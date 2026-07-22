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

  perform pg_advisory_xact_lock(hashtextextended(target_store_id::text, 0));

  select * into existing_order
  from public.orders
  where store_id = target_store_id and checkout_request_id = request_id;
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
    if existing_order.payment_status in ('pending', 'paid') then return existing_order; end if;
    renew_existing := true;
  end if;

  -- Stock belongs to the product, so quantities from separate option rows must
  -- be added together before availability is checked.
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

revoke all on function public.create_stripe_order_with_reservation(uuid, text, text, jsonb, text, text, text, numeric, numeric, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_stripe_order_with_reservation(uuid, text, text, jsonb, text, text, text, numeric, numeric, text, timestamptz) to service_role;

