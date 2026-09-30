\set ON_ERROR_STOP on
begin;

-- Exercise the real reservation RPC: 100 x 9.99 EUR previously collected
-- 39.00 net + 9.75 VAT, exceeding the advertised 48.36 EUR monthly ceiling.
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('78100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'fee-rounding@example.invalid', now(), '{}', '{}', now(), now());

do $$
declare
  shop public.stores%rowtype;
  payment public.orders%rowtype;
  retry public.orders%rowtype;
  type_value text;
  index_value integer;
  gross integer;
  net integer;
begin
  foreach type_value in array array['company', 'entrepreneur'] loop
    insert into public.stores(owner_id, name, slug, settings)
    values ('78100000-0000-4000-8000-000000000001', 'Fee test', 'fee-rounding-' || type_value,
      jsonb_build_object('sellerType', type_value, 'sellerFirstName', 'Liisa', 'sellerLastName', 'Tamm'))
    returning * into shop;
    insert into public.products(id, store_id, name, image_url, price, stock)
    values ('fee-rounding-' || type_value, shop.id, 'Test product', '', 9.99, null);

    for index_value in 1..100 loop
      payment := public.create_stripe_order_with_reservation(shop.id, 'fee-rounding-request-' || index_value,
        'PR-FEE-' || type_value || '-' || index_value,
        jsonb_build_array(jsonb_build_object('id', 'fee-rounding-' || type_value, 'quantity', 1)),
        'Buyer', 'buyer@example.invalid', 'Pickup', 9.99, 9.99, 'test', now() + interval '35 minutes');
      if payment.stripe_platform_fee_vat_cents <> round(payment.stripe_platform_fee_net_cents * 0.24)
        or payment.stripe_platform_fee_cents <> payment.stripe_platform_fee_net_cents + payment.stripe_platform_fee_vat_cents then
        raise exception 'Per-payment VAT or gross fee does not reconcile';
      end if;
    end loop;
    select sum(stripe_platform_fee_cents), sum(stripe_platform_fee_net_cents) into gross, net
    from public.orders where store_id = shop.id and stripe_mode = 'test';
    if gross <> 4836 or net > 3900 or payment.stripe_platform_fee_cents <> 0 then
      raise exception 'Monthly fee cap failed for %: gross %, net %, last fee %', type_value, gross, net, payment.stripe_platform_fee_cents;
    end if;

    -- Retrying the first request retains its original fee even after the cap.
    retry := public.create_stripe_order_with_reservation(shop.id, 'fee-rounding-request-1', 'ignored-retry-number',
      jsonb_build_array(jsonb_build_object('id', 'fee-rounding-' || type_value, 'quantity', 1)),
      'Buyer', 'buyer@example.invalid', 'Pickup', 9.99, 9.99, 'test', now() + interval '35 minutes');
    if retry.stripe_platform_fee_cents <> 50 then raise exception 'Retry changed captured fees'; end if;

    payment := public.create_stripe_order_with_reservation(shop.id, 'fee-rounding-live-request', 'PR-FEE-LIVE-' || type_value,
      jsonb_build_array(jsonb_build_object('id', 'fee-rounding-' || type_value, 'quantity', 1)),
      'Buyer', 'buyer@example.invalid', 'Pickup', 9.99, 9.99, 'live', now() + interval '35 minutes');
    if payment.stripe_platform_fee_net_cents <> 40 or payment.stripe_platform_fee_vat_cents <> 10 then
      raise exception 'Test reservations consumed the live fee allowance';
    end if;

    -- An expired, unstarted reservation releases exactly its reserved amount.
    update public.orders set reservation_expires_at = now() - interval '1 second' where id = retry.id;
    payment := public.create_stripe_order_with_reservation(shop.id, 'fee-rounding-released-request', 'PR-FEE-RELEASED-' || type_value,
      jsonb_build_array(jsonb_build_object('id', 'fee-rounding-' || type_value, 'quantity', 1)),
      'Buyer', 'buyer@example.invalid', 'Pickup', 9.75, 9.75, 'test', now() + interval '35 minutes');
    if payment.stripe_platform_fee_cents <> 48 then raise exception 'Expired fee reservation was not released'; end if;
    -- Two cents remain: a one-cent net fee has zero rounded VAT and must fit.
    for index_value in 1..3 loop
      payment := public.create_stripe_order_with_reservation(shop.id, 'fee-rounding-cent-request-' || index_value,
        'PR-FEE-CENT-' || type_value || '-' || index_value,
        jsonb_build_array(jsonb_build_object('id', 'fee-rounding-' || type_value, 'quantity', 1)),
        'Buyer', 'buyer@example.invalid', 'Pickup', 0.25, 0.25, 'test', now() + interval '35 minutes');
      if payment.stripe_platform_fee_net_cents <> (case when index_value <= 2 then 1 else 0 end)
        or payment.stripe_platform_fee_vat_cents <> 0 then
        raise exception 'The final cents of the monthly allowance were rounded incorrectly';
      end if;
    end loop;
  end loop;
end;
$$;
rollback;
