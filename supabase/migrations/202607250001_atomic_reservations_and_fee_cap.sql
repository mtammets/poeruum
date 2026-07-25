alter table public.orders
  add column if not exists platform_fee_period_start date;

update public.orders
set platform_fee_period_start = date_trunc('month', created_at at time zone 'Europe/Tallinn')::date
where platform_fee_period_start is null
  and stripe_platform_fee_net_cents > 0;

create index if not exists orders_platform_fee_period_idx
  on public.orders(store_id, platform_fee_period_start)
  where payment_status in ('pending', 'paid');

comment on column public.orders.platform_fee_period_start is
  'Tallinn calendar month whose flexible-plan fee cap this checkout reserves.';

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
  fee_net_cents integer := 0;
  fee_vat_cents integer := 0;
  renew_existing boolean := false;
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

  -- Stock reservations and the monthly fee allowance share one per-store lock.
  -- This makes both decisions serial even when checkout requests arrive together.
  perform pg_advisory_xact_lock(hashtextextended(target_store_id::text, 0));

  select store.pricing_plan
  into store_pricing_plan
  from public.stores as store
  where store.id = target_store_id;
  if not found then raise exception 'STORE_UNAVAILABLE'; end if;

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

  -- Quantities from separate option rows still consume the same product stock.
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
        )
        and reserved_item ->> 'id' = product_row.id;

      if requested_quantity + reserved_quantity > (case when product_row.one_of_a_kind then 1 else product_row.stock end) then
        raise exception 'INSUFFICIENT_STOCK:%', product_row.name;
      end if;
    end if;
  end loop;

  fee_period_start := date_trunc('month', now() at time zone 'Europe/Tallinn')::date;
  if store_pricing_plan = 'flexible' then
    select coalesce(sum(candidate.stripe_platform_fee_net_cents), 0)
    into reserved_fee_net_cents
    from public.orders as candidate
    where candidate.store_id = target_store_id
      and candidate.platform_fee_period_start = fee_period_start
      and candidate.id is distinct from existing_order.id
      and (
        candidate.payment_status = 'paid'
        or (
          candidate.payment_status = 'pending'
          and (
            candidate.reservation_expires_at > now()
            or candidate.stripe_checkout_session_id is not null
          )
        )
      );

    fee_net_cents := least(
      round(product_subtotal_value * 100 * 0.04)::integer,
      greatest(0, 3900 - reserved_fee_net_cents)::integer
    );
    fee_vat_cents := round(fee_net_cents * 0.24)::integer;
  end if;

  if renew_existing then
    update public.orders
    set payment_status = 'pending',
        reservation_expires_at = reservation_expires_at_value,
        stripe_platform_fee_net_cents = fee_net_cents,
        stripe_platform_fee_vat_cents = fee_vat_cents,
        stripe_platform_fee_cents = fee_net_cents + fee_vat_cents,
        platform_fee_period_start = fee_period_start
    where id = existing_order.id
    returning * into created_order;
    return created_order;
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

create or replace function public.release_expired_unstarted_stripe_orders(batch_size_value integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released_count integer;
begin
  with expired as (
    select target.id
    from public.orders as target
    where target.payment_status = 'pending'
      and target.reservation_expires_at <= now()
      and target.stripe_checkout_session_id is null
    order by target.reservation_expires_at
    limit greatest(1, least(coalesce(batch_size_value, 100), 500))
    for update skip locked
  )
  update public.orders as target
  set payment_status = 'failed',
      reservation_expires_at = null
  from expired
  where target.id = expired.id;

  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

revoke all on function public.create_stripe_order_with_reservation(uuid, text, text, jsonb, text, text, text, numeric, numeric, text, timestamptz) from public, anon, authenticated;
revoke all on function public.release_expired_unstarted_stripe_orders(integer) from public, anon, authenticated;
grant execute on function public.create_stripe_order_with_reservation(uuid, text, text, jsonb, text, text, text, numeric, numeric, text, timestamptz) to service_role;
grant execute on function public.release_expired_unstarted_stripe_orders(integer) to service_role;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'poeruum-stripe-reservation-reaper';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'poeruum-stripe-reservation-reaper',
    '*/5 * * * *',
    $schedule$
      select net.http_post(
        url := replace(
          (select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_reminders_url' limit 1),
          '/onboarding-reminders',
          '/stripe-reservation-reaper'
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_cron_secret' limit 1)
        ),
        body := '{}'::jsonb
      );
    $schedule$
  );
end $$;
