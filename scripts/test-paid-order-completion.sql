\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('79000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'payment-completion@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.stores (id, owner_id, name, slug)
values ('79000000-0000-4000-8000-000000000002', '79000000-0000-4000-8000-000000000001',
  'Payment completion test', 'payment-completion-test');

insert into public.products (id, store_id, name, image_url, price, stock)
values ('payment-completion-product', '79000000-0000-4000-8000-000000000002',
  'Payment completion product', 'https://example.invalid/product.webp', 27.32, 3);

insert into public.orders (
  id, store_id, order_number, items, customer_name, customer_email, delivery,
  product_subtotal, total, payment_status, stripe_mode, stripe_checkout_session_id, reservation_expires_at
) values (
  '79000000-0000-4000-8000-000000000003', '79000000-0000-4000-8000-000000000002', 'PR-COMPLETION-TEST',
  '[{"id":"payment-completion-product","quantity":1}]'::jsonb, 'Test customer', 'customer@example.invalid',
  'Tulen ise järele', 27.32, 27.32, 'pending', 'test', 'cs_test_completion', now() + interval '30 minutes'
);

do $$
begin
  if has_function_privilege('anon', 'public.complete_stripe_order(uuid,text,text)', 'execute')
    or has_function_privilege('authenticated', 'public.complete_stripe_order(uuid,text,text)', 'execute') then
    raise exception 'CLIENT_CAN_CONFIRM_PAYMENT';
  end if;
  if not has_function_privilege('service_role', 'public.complete_stripe_order(uuid,text,text)', 'execute') then
    raise exception 'SERVICE_CANNOT_CONFIRM_PAYMENT';
  end if;
end;
$$;

do $$
declare
  test_order_id uuid := '79000000-0000-4000-8000-000000000003';
  payment public.orders%rowtype;
  remaining_stock integer;
begin
  begin
    perform public.complete_stripe_order(test_order_id, 'cs_wrong', 'pi_test_completion');
    raise exception 'WRONG_CHECKOUT_ACCEPTED';
  exception when others then
    if sqlerrm <> 'ORDER_PAYMENT_MISMATCH' then raise; end if;
  end;
  begin
    perform public.complete_stripe_order(test_order_id, 'cs_test_completion', null);
    raise exception 'MISSING_PAYMENT_ACCEPTED';
  exception when others then
    if sqlerrm <> 'PAYMENT_REFERENCE_REQUIRED' then raise; end if;
  end;

  select * into payment from public.orders where id = test_order_id;
  select stock into remaining_stock from public.products where id = 'payment-completion-product';
  if payment.payment_status <> 'pending' or remaining_stock <> 3 then
    raise exception 'INVALID_CONFIRMATION_CHANGED_ORDER_OR_STOCK';
  end if;

  perform public.complete_stripe_order(test_order_id, 'cs_test_completion', 'pi_test_completion');
  perform public.complete_stripe_order(test_order_id, 'cs_test_completion', 'pi_test_completion');
  select * into payment from public.orders where id = test_order_id;
  select stock into remaining_stock from public.products where id = 'payment-completion-product';
  if payment.payment_status <> 'paid' or payment.reservation_expires_at is not null
    or payment.stripe_payment_intent_id <> 'pi_test_completion' or remaining_stock <> 2 then
    raise exception 'PAYMENT_NOT_CONFIRMED_ONCE';
  end if;
  if payment.stripe_transfer_id is not null or payment.stripe_processing_fee_cents <> 0 then
    raise exception 'CONFIRMATION_DEPENDS_ON_SETTLEMENT';
  end if;

  begin
    perform public.complete_stripe_order(test_order_id, 'cs_test_completion', 'pi_other');
    raise exception 'PAYMENT_REFERENCE_REPLACED';
  exception when others then
    if sqlerrm <> 'ORDER_PAYMENT_MISMATCH' then raise; end if;
  end;

  update public.orders set payment_status = 'refunded', status = 'refunded' where id = test_order_id;
  perform public.complete_stripe_order(test_order_id, 'cs_test_completion', 'pi_test_completion');
  select * into payment from public.orders where id = test_order_id;
  select stock into remaining_stock from public.products where id = 'payment-completion-product';
  if payment.payment_status <> 'refunded' or payment.status <> 'refunded' or remaining_stock <> 2 then
    raise exception 'LATE_EVENT_REOPENED_REFUND_OR_CHANGED_STOCK';
  end if;
end;
$$;

-- Exercise the security-definer RPC as the server role too. Direct fixture
-- inspection above uses postgres and does not depend on local table grants.
set local role service_role;
select public.complete_stripe_order(
  '79000000-0000-4000-8000-000000000003', 'cs_test_completion', 'pi_test_completion'
);
reset role;

rollback;
