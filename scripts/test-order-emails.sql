\set ON_ERROR_STOP on
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end;
$$;
create function pg_temp.expect_error(statement text, message text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then if sqlerrm = message then return; else raise; end if;
  end;
  raise exception 'Expected error: %', message;
end;
$$;
create function pg_temp.email_payload(job public.order_email_jobs) returns jsonb language sql as $$
select jsonb_build_object('from','Shop <test@example.invalid>', 'to',jsonb_build_array(case job.kind when 'customer' then 'customer@example.invalid' else 'seller@example.invalid' end),
  'subject','Test order', 'html','<p>Paid order</p>', 'text','Paid order', 'tags', jsonb_build_array(
    jsonb_build_object('name','email_type','value',case job.kind when 'customer' then 'order_customer_confirmation' else 'order_seller_notification' end),
    jsonb_build_object('name','order_id','value',job.order_id::text), jsonb_build_object('name','order_email_job_id','value',job.id::text)));
$$;

insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('77000000-0000-4000-8000-000000000001','authenticated','authenticated','email-queue@example.invalid','{}','{}',now(),now());
insert into public.stores(id, owner_id, name, slug, settings)
values ('77000000-0000-4000-8000-000000000002','77000000-0000-4000-8000-000000000001','Email queue test','email-queue-test',
  '{"contactEmail":"seller@example.invalid","customerConfirmations":true,"sellerNotifications":true}');
insert into public.orders(id, store_id, order_number, items, customer_name, customer_email, delivery,
  product_subtotal, total, payment_status, stripe_mode, stripe_checkout_session_id)
select ('77000000-0000-4000-8000-00000000000' || n)::uuid,'77000000-0000-4000-8000-000000000002','PR-EMAIL-' || n,
  '[]','Test Customer','customer@example.invalid','Pickup',27.32,27.32,'pending','test','cs_email_' || n from generate_series(3,6) n;

do $$
declare fn regprocedure;
begin
  foreach fn in array array[
    'public.claim_order_email_job(text,uuid,text)'::regprocedure,
    'public.prepare_order_email_send(uuid,uuid,jsonb)'::regprocedure,
    'public.finish_order_email_job(uuid,uuid,text,text,text)'::regprocedure,
    'public.record_order_email_delivery(uuid,uuid,text,text,text,text,text,timestamptz)'::regprocedure
  ] loop
    perform pg_temp.assert_true(not has_function_privilege('anon',fn,'execute')
      and not has_function_privilege('authenticated',fn,'execute') and has_function_privilege('service_role',fn,'execute'), 'Email RPC exposed to clients');
  end loop;
  perform pg_temp.assert_true(not has_table_privilege('authenticated','public.order_email_jobs','select')
    and not has_table_privilege('anon','public.order_email_jobs','select'), 'Private email payloads exposed');
  begin
    perform public.complete_stripe_order('77000000-0000-4000-8000-000000000003','cs_email_3','pi_email_3');
    raise exception 'ROLLBACK_TEST';
  exception when others then if sqlerrm <> 'ROLLBACK_TEST' then raise; end if;
  end;
  perform pg_temp.assert_true(not exists(select 1 from public.order_email_jobs where order_id = '77000000-0000-4000-8000-000000000003'),
    'Email jobs survived payment rollback');
end;
$$;
set local role service_role;
select public.complete_stripe_order('77000000-0000-4000-8000-000000000003','cs_email_3','pi_email_3');
reset role;

do $$
declare
  oid uuid := '77000000-0000-4000-8000-000000000003';
  customer public.order_email_jobs%rowtype; seller public.order_email_jobs%rowtype;
  old_token uuid; original_payload jsonb;
begin
  perform public.complete_stripe_order(oid,'cs_email_3','pi_email_3');
  perform pg_temp.assert_true((select count(*) = 2 from public.order_email_jobs where order_id = oid), 'Expected exactly two independent jobs');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_order_email_job('live',oid)), 'Email worker crossed Stripe modes');
  select * into customer from public.claim_order_email_job('test',oid,'customer');
  select * into seller from public.claim_order_email_job('test',oid,'seller');
  perform pg_temp.assert_true(customer.lease_token is not null and seller.lease_token is not null, 'Recipient jobs block each other');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_order_email_job('test',oid)), 'Active lease claimed twice');
  perform pg_temp.expect_error(format('select public.prepare_order_email_send(%L,null,''{}'')',customer.id), 'EMAIL_LEASE_LOST');
  perform pg_temp.expect_error(format('select public.prepare_order_email_send(%L,%L,''{}'')',customer.id,customer.lease_token), 'INVALID_EMAIL_PAYLOAD');
  perform pg_temp.expect_error(format('select public.finish_order_email_job(%L,%L,''accepted'')',customer.id,customer.lease_token), 'EMAIL_ACCEPTANCE_REFERENCE_REQUIRED');
  original_payload := pg_temp.email_payload(customer);
  customer := public.prepare_order_email_send(customer.id,customer.lease_token,original_payload);
  customer := public.prepare_order_email_send(customer.id,customer.lease_token,original_payload || '{"subject":"Changed shop name"}');
  perform pg_temp.assert_true(customer.payload = original_payload, 'Retry changed the provider payload');
  perform public.finish_order_email_job(customer.id,customer.lease_token,'retry',null,'Provider unavailable');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_order_email_job('test',oid,'customer')), 'Retry ignored the backoff');
  seller := public.prepare_order_email_send(seller.id,seller.lease_token,pg_temp.email_payload(seller));
  -- Signed delivered event arrives before the HTTP send response.
  perform public.record_order_email_delivery(seller.id,oid,'seller','evt-email-seller-delivered','resend-seller','seller@example.invalid','delivered','2026-09-09T14:00:02Z');
  seller := public.finish_order_email_job(seller.id,seller.lease_token,'retry',null,'HTTP response lost');
  perform pg_temp.assert_true(seller.status = 'accepted' and seller.delivery_status = 'delivered' and seller.resend_email_id = 'resend-seller',
    'Worker overwrote an early delivery confirmation');
  perform pg_temp.assert_true((select customer_confirmation_sent_at is null and seller_notification_sent_at is not null from public.orders where id = oid),
    'Recipient timestamps are not independent');
  perform public.record_order_email_delivery(seller.id,oid,'seller','evt-email-seller-delivered','resend-seller','seller@example.invalid','delivered','2026-09-09T14:00:02Z');
  perform public.record_order_email_delivery(seller.id,oid,'seller','evt-email-seller-sent-old','resend-seller','seller@example.invalid','sent','2026-09-09T14:00:01Z');
  perform public.record_order_email_delivery(seller.id,oid,'seller','evt-email-seller-sent-new','resend-seller','seller@example.invalid','sent','2026-09-09T14:00:03Z');
  perform pg_temp.assert_true((select delivery_status = 'delivered' and delivery_event_at = '2026-09-09T14:00:02Z' from public.order_email_jobs where id = seller.id),
    'Out-of-order sent event downgraded delivery');
  perform pg_temp.assert_true((select status = 'delivered' from public.email_deliveries where resend_email_id = 'resend-seller'), 'Delivery log disagrees with job');
  perform pg_temp.expect_error(format('select public.record_order_email_delivery(%L,%L,''seller'',''evt-email-wrong'',''resend-seller'',''other@example.invalid'',''delivered'',now())',seller.id,oid),
    'EMAIL_EVENT_MISMATCH');
  perform pg_temp.assert_true(not exists(select 1 from public.resend_webhook_events where id = 'evt-email-wrong'), 'Invalid event left a receipt');

  update public.order_email_jobs set next_attempt_at = now() where id = customer.id;
  select * into customer from public.claim_order_email_job('test',oid,'customer');
  old_token := customer.lease_token;
  update public.order_email_jobs set lease_expires_at = now() - interval '1 second' where id = customer.id;
  select * into customer from public.claim_order_email_job('test',oid,'customer');
  perform pg_temp.assert_true(customer.lease_token <> old_token, 'Expired lease reused');
  perform pg_temp.expect_error(format('select public.finish_order_email_job(%L,%L,''accepted'',''resend-customer'')',customer.id,old_token), 'EMAIL_LEASE_LOST');
  customer := public.finish_order_email_job(customer.id,customer.lease_token,'accepted','resend-customer');
  perform pg_temp.assert_true(customer.accepted_at is not null and customer.delivered_at is null and customer.delivery_status = 'sent',
    'HTTP acceptance falsely claimed delivery');
  perform public.record_order_email_delivery(customer.id,oid,'customer','evt-email-delayed','resend-customer','customer@example.invalid','delivery_delayed',now());
  perform public.record_order_email_delivery(customer.id,oid,'customer','evt-email-failed','resend-customer','customer@example.invalid','failed',now() + interval '1 second');
  perform pg_temp.assert_true((select delivery_status = 'failed' and status = 'accepted' from public.order_email_jobs where id = customer.id), 'Delivery failure not recorded');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_order_email_job('test',oid)), 'Accepted/failed mail automatically sent again');
end;
$$;

do $$
declare oid uuid := '77000000-0000-4000-8000-000000000004'; job public.order_email_jobs%rowtype;
begin
  update public.stores set settings = settings || '{"customerConfirmations":false}' where id = '77000000-0000-4000-8000-000000000002';
  perform public.complete_stripe_order(oid,'cs_email_4','pi_email_4');
  perform pg_temp.assert_true((select status = 'skipped' from public.order_email_jobs where order_id = oid and kind = 'customer'), 'Disabled confirmation enqueued for sending');
  select * into job from public.claim_order_email_job('test',oid,'seller');
  update public.stores set settings = settings || '{"sellerNotifications":false}' where id = '77000000-0000-4000-8000-000000000002';
  job := public.prepare_order_email_send(job.id,job.lease_token,pg_temp.email_payload(job));
  perform pg_temp.assert_true(job.status = 'skipped' and job.payload is null, 'First send ignored current shop settings');
  perform public.finish_order_email_job(job.id,job.lease_token,'skipped');
  update public.stores set settings = settings || '{"customerConfirmations":true,"sellerNotifications":true}' where id = '77000000-0000-4000-8000-000000000002';
  perform public.complete_stripe_order(oid,'cs_email_4','pi_email_4');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_order_email_job('test',oid)), 'Re-enabling notifications resent old orders');
end;
$$;

-- A delivery DB failure must roll back the receipt, the provider ID and the
-- order timestamp together, otherwise the provider retry would be discarded.
create function pg_temp.reject_email_delivery() returns trigger language plpgsql as $$
begin raise exception 'TEST_DELIVERY_WRITE_FAILED'; end;
$$;
create trigger reject_email_delivery before insert on public.email_deliveries
  for each row execute function pg_temp.reject_email_delivery();
do $$
declare oid uuid := '77000000-0000-4000-8000-000000000005'; job public.order_email_jobs%rowtype;
begin
  perform public.complete_stripe_order(oid,'cs_email_5','pi_email_5');
  select * into job from public.claim_order_email_job('test',oid,'customer');
  job := public.prepare_order_email_send(job.id,job.lease_token,pg_temp.email_payload(job));
  perform pg_temp.expect_error(format('select public.record_order_email_delivery(%L,%L,''customer'',''evt-email-atomic'',''resend-atomic'',''customer@example.invalid'',''delivered'',now())',job.id,oid),
    'TEST_DELIVERY_WRITE_FAILED');
  perform pg_temp.assert_true(not exists(select 1 from public.resend_webhook_events where id = 'evt-email-atomic'), 'Receipt survived delivery rollback');
  perform pg_temp.assert_true((select resend_email_id is null from public.order_email_jobs where id = job.id), 'Provider ID survived rollback');
  perform pg_temp.assert_true((select customer_confirmation_sent_at is null from public.orders where id = oid), 'Order timestamp survived rollback');
end;
$$;
drop trigger reject_email_delivery on public.email_deliveries;
do $$
declare oid uuid := '77000000-0000-4000-8000-000000000005'; job public.order_email_jobs%rowtype;
begin
  select * into job from public.order_email_jobs where order_id = oid and kind = 'customer';
  perform public.finish_order_email_job(job.id,job.lease_token,'needs_review',null,'Uncertain old send');
  perform public.record_order_email_delivery(job.id,oid,'customer','evt-email-atomic','resend-atomic','customer@example.invalid','delivered',now());
  perform pg_temp.assert_true((select status = 'accepted' and delivery_status = 'delivered' from public.order_email_jobs where id = job.id),
    'Late delivery could not reconcile uncertain send');
  perform pg_temp.assert_true((select count(*) = 1 from public.resend_webhook_events where id = 'evt-email-atomic'), 'Receipt not recorded on retry');
  select * into job from public.claim_order_email_job('test',oid,'seller');
  update public.orders set payment_status = 'refunded', status = 'refunded' where id = oid;
  job := public.prepare_order_email_send(job.id,job.lease_token,pg_temp.email_payload(job));
  perform pg_temp.assert_true(job.status = 'skipped', 'New paid confirmation sent after refund');
end;
$$;

do $$
declare oid uuid := '77000000-0000-4000-8000-000000000006'; job public.order_email_jobs%rowtype;
begin
  perform public.complete_stripe_order(oid,'cs_email_6','pi_email_6');
  -- Old sender finishes during deployment, after the new job was enqueued.
  update public.orders set customer_confirmation_sent_at = now() where id = oid;
  select * into job from public.claim_order_email_job('test',oid,'customer');
  job := public.prepare_order_email_send(job.id,job.lease_token);
  job := public.finish_order_email_job(job.id,job.lease_token,'accepted');
  perform pg_temp.assert_true(job.status = 'accepted' and job.legacy_import and job.payload is null and job.resend_email_id is null,
    'Old sender completion triggered a duplicate send during deployment');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_order_email_job('test',oid,'customer')), 'Legacy acceptance reclaimed');
end;
$$;

rollback;
