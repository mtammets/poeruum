\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end;
$$;
insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('78000000-0000-4000-8000-000000000001','authenticated','authenticated','receipt@example.invalid','{}','{}',now(),now());
insert into public.stores(id, owner_id, name, slug)
values ('78000000-0000-4000-8000-000000000002','78000000-0000-4000-8000-000000000001','Receipt test','receipt-test');
insert into public.orders(id, store_id, order_number, items, customer_name, customer_email, delivery, product_subtotal, total, payment_status, stripe_mode)
select ('78000000-0000-4000-8000-00000000000' || n)::uuid,'78000000-0000-4000-8000-000000000002','PR-RECEIPT-' || n,
  '[]','Test Customer','customer@example.invalid','Pickup',27.32,27.32,'pending','test' from generate_series(3,4) n;
set local role service_role;
select public.get_or_create_order_receipt_token('78000000-0000-4000-8000-000000000003') is not null as created;
reset role;
do $$
declare first_token text; second_token text;
begin
  first_token := public.get_or_create_order_receipt_token('78000000-0000-4000-8000-000000000003');
  perform pg_temp.assert_true(first_token ~ '^[0-9a-f]{64}$', 'Receipt token must have 256 random bits');
  perform pg_temp.assert_true(first_token = public.get_or_create_order_receipt_token('78000000-0000-4000-8000-000000000003'), 'Retry rotated the receipt link');
  second_token := public.get_or_create_order_receipt_token('78000000-0000-4000-8000-000000000004');
  perform pg_temp.assert_true(first_token <> second_token, 'Orders share a receipt token');
  perform pg_temp.assert_true(not has_table_privilege('anon','public.order_receipt_access','select')
    and not has_table_privilege('authenticated','public.order_receipt_access','select'), 'Receipt credentials exposed to clients');
  perform pg_temp.assert_true(not has_function_privilege('anon','public.get_or_create_order_receipt_token(uuid)','execute')
    and not has_function_privilege('authenticated','public.get_or_create_order_receipt_token(uuid)','execute'), 'Receipt creation exposed to clients');
  perform public.complete_stripe_order('78000000-0000-4000-8000-000000000003','cs_receipt_test','pi_receipt_test');
  perform public.complete_stripe_order('78000000-0000-4000-8000-000000000003','cs_receipt_test','pi_receipt_test');
  perform pg_temp.assert_true((select count(*) = 2 from public.order_email_jobs where order_id = '78000000-0000-4000-8000-000000000003'), 'Receipt/webhook confirmation duplicated or missed email jobs');
  perform pg_temp.assert_true((select count(*) = 1 from public.stripe_order_settlements where order_id = '78000000-0000-4000-8000-000000000003'), 'Receipt/webhook confirmation duplicated or missed settlement job');
  delete from public.orders where id = '78000000-0000-4000-8000-000000000004';
  perform pg_temp.assert_true(not exists(select 1 from public.order_receipt_access where token = second_token), 'Deleted order left a receipt credential');
end;
$$;
rollback;
