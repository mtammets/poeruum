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

insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('78000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'settlement@example.invalid', '{}', '{}', now(), now());
insert into public.stores(id, owner_id, name, slug, stripe_account_id)
values ('78000000-0000-4000-8000-000000000002', '78000000-0000-4000-8000-000000000001',
  'Settlement test', 'settlement-test', 'acct_test');
insert into public.orders(id, store_id, order_number, items, customer_name, customer_email, delivery,
  product_subtotal, total, payment_status, stripe_mode, stripe_checkout_session_id)
select ('78000000-0000-4000-8000-00000000000' || n)::uuid, '78000000-0000-4000-8000-000000000002',
  'PR-SETTLEMENT-' || n, '[]', 'Test', 'customer@example.invalid', 'Pickup', 27.32, 27.32, 'pending', 'test', 'cs_test_' || n
from generate_series(3, 5) n;

do $$
declare fn regprocedure;
begin
  foreach fn in array array[
    'public.claim_stripe_order_settlement(text,uuid)'::regprocedure,
    'public.request_stripe_order_refund(uuid,text)'::regprocedure,
    'public.prepare_stripe_order_operation(uuid,uuid,text,jsonb,jsonb)'::regprocedure,
    'public.record_stripe_order_transfer(uuid,uuid,text)'::regprocedure,
    'public.finish_stripe_order_settlement(uuid,uuid,text,text,text)'::regprocedure,
    'public.check_stripe_order_settlement_lease(uuid,uuid)'::regprocedure
  ] loop
    perform pg_temp.assert_true(not has_function_privilege('anon', fn, 'execute')
      and not has_function_privilege('authenticated', fn, 'execute')
      and has_function_privilege('service_role', fn, 'execute'), 'Job RPC access is not server-only');
  end loop;
  perform pg_temp.assert_true(not has_table_privilege('authenticated', 'public.stripe_order_settlements', 'select')
    and not has_table_privilege('anon', 'public.stripe_order_settlements', 'select'), 'Private jobs exposed');
  perform pg_temp.assert_true(not has_column_privilege('authenticated', 'public.orders', 'stripe_refund_status', 'update'),
    'Customer can change refund status');
  -- Job insertion must roll back with payment confirmation.
  begin
    perform public.complete_stripe_order('78000000-0000-4000-8000-000000000003', 'cs_test_3', 'pi_test_3');
    raise exception 'ROLLBACK_TEST';
  exception when others then if sqlerrm <> 'ROLLBACK_TEST' then raise; end if;
  end;
  perform pg_temp.assert_true(not exists(select 1 from public.stripe_order_settlements), 'Orphan job survived payment rollback');
end;
$$;

set local role service_role;
select public.complete_stripe_order('78000000-0000-4000-8000-000000000003', 'cs_test_3', 'pi_test_3');
select public.complete_stripe_order('78000000-0000-4000-8000-000000000003', 'cs_test_3', 'pi_test_3');
reset role;

do $$
declare
  oid uuid := '78000000-0000-4000-8000-000000000003';
  job public.stripe_order_settlements%rowtype;
  token uuid; old_token uuid; payload jsonb;
  amounts jsonb := '{"seller_net_cents":2544,"processing_fee_cents":66,"platform_fee_net_cents":98,"platform_fee_vat_cents":24}';
begin
  perform pg_temp.assert_true((select count(*) = 1 from public.stripe_order_settlements), 'Repeated confirmation duplicated job');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_stripe_order_settlement('live', oid)), 'Claim crossed Stripe modes');
  select * into job from public.claim_stripe_order_settlement('test', oid);
  token := job.lease_token;
  perform pg_temp.assert_true(token is not null, 'Job not claimable');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_stripe_order_settlement('test', oid)), 'Concurrent claim took active job');
  perform pg_temp.expect_error(format('select public.check_stripe_order_settlement_lease(%L,null)', oid), 'SETTLEMENT_LEASE_LOST');
  perform pg_temp.expect_error(format('select public.finish_stripe_order_settlement(%L,%L,''completed'')', oid, token), 'TRANSFER_REFERENCE_REQUIRED');
  perform pg_temp.expect_error(format('select public.prepare_stripe_order_operation(%L,%L,''transfer'',''{}'',''{}'')', oid, token), 'INVALID_TRANSFER_PAYLOAD');
  perform public.finish_stripe_order_settlement(oid, token, 'waiting_for_fee');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_stripe_order_settlement('test')), 'Cron ignored retry schedule');
  -- A charge.updated event can wake the delayed job immediately.
  select * into job from public.claim_stripe_order_settlement('test', oid);
  old_token := job.lease_token;
  update public.stripe_order_settlements set lease_expires_at = now() - interval '1 second' where order_id = oid;
  select * into job from public.claim_stripe_order_settlement('test', oid);
  token := job.lease_token;
  perform pg_temp.assert_true(token <> old_token, 'Lease token was reused');
  perform pg_temp.expect_error(format('select public.finish_stripe_order_settlement(%L,%L,''retry'')', oid, old_token), 'SETTLEMENT_LEASE_LOST');
  payload := jsonb_build_object('amount',2544,'currency','eur','destination','acct_test','source_transaction','ch_test',
    'transfer_group','order_' || oid, 'metadata',jsonb_build_object('order_id',oid,'store_id','78000000-0000-4000-8000-000000000002','payment_intent_id','pi_test_3'));
  job := public.prepare_stripe_order_operation(oid, token, 'transfer', payload, amounts);
  job := public.prepare_stripe_order_operation(oid, token, 'transfer', payload || '{"amount":1}', '{}');
  perform pg_temp.assert_true(job.transfer_payload = payload and job.settlement_data = amounts, 'Prepared operation changed on retry');
  perform public.record_stripe_order_transfer(oid, token, 'tr_test_settlement');
  perform public.record_stripe_order_transfer(oid, token, 'tr_test_settlement');
  perform pg_temp.assert_true((select stripe_transfer_id = 'tr_test_settlement' and stripe_seller_net_cents = 2544
    and stripe_processing_fee_cents = 66 and stripe_platform_fee_cents = 122 from public.orders where id = oid), 'Transfer snapshot not saved');
  perform pg_temp.assert_true((select count(*) = 1 and sum(amount_cents) = 98 from public.revenue_events
    where provider_object_id = 'tr_test_settlement'), 'Transfer income duplicated');
  perform pg_temp.expect_error(format('select public.record_stripe_order_transfer(%L,%L,''tr_wrong'')', oid, token), 'ORDER_TRANSFER_MISMATCH');
  -- Refund arriving during processing must preserve the lease and remain due.
  job := public.request_stripe_order_refund(oid, 'test');
  perform pg_temp.assert_true(job.lease_token = token, 'Refund stole the lease');
  job := public.finish_stripe_order_settlement(oid, token, 'completed');
  perform pg_temp.assert_true(job.status = 'retry', 'Concurrent refund was lost');
  select * into job from public.claim_stripe_order_settlement('test', oid);
  token := job.lease_token;
  perform public.prepare_stripe_order_operation(oid, token, 'refund',
    jsonb_build_object('payment_intent','pi_test_3','metadata',jsonb_build_object('order_id',oid)));
  perform public.finish_stripe_order_settlement(oid, token, 'refund_pending', null, 're_test_settlement');
  perform pg_temp.assert_true((select payment_status = 'paid' and stripe_refund_status = 'pending'
    from public.orders where id = oid), 'Pending refund falsely marked refunded');
  select * into job from public.claim_stripe_order_settlement('test', oid);
  perform public.finish_stripe_order_settlement(oid, job.lease_token, 'refunded', null, 're_test_settlement');
  perform public.request_stripe_order_refund(oid, 'test');
  perform public.complete_stripe_order(oid, 'cs_test_3', 'pi_test_3');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_stripe_order_settlement('test', oid)), 'Finished refund reopened');
  perform pg_temp.assert_true((select payment_status = 'refunded' and status = 'refunded' and stripe_refund_status = 'succeeded'
    from public.orders where id = oid), 'Confirmed refund not saved');
  perform pg_temp.assert_true((select count(*) = 1 and sum(amount_cents) = -98 from public.revenue_events
    where provider_object_id = 're_test_settlement'), 'Refund income missing or duplicated');
end;
$$;

do $$
declare oid uuid := '78000000-0000-4000-8000-000000000004'; job public.stripe_order_settlements%rowtype; token uuid;
begin
  perform public.complete_stripe_order(oid, 'cs_test_4', 'pi_test_4');
  select * into job from public.claim_stripe_order_settlement('test', oid);
  token := job.lease_token;
  perform public.request_stripe_order_refund(oid, 'test');
  job := public.prepare_stripe_order_operation(oid, token, 'transfer', '{}', '{}');
  perform pg_temp.assert_true(job.transfer_payload is null and job.refund_requested_at is not null, 'Refund did not suppress unstarted transfer');
  perform public.finish_stripe_order_settlement(oid, token, 'refunded', null, 're_before_transfer');
  perform pg_temp.assert_true(not exists(select 1 from public.revenue_events where provider_object_id = 're_before_transfer'),
    'Refund credited a fee that was never recorded');
end;
$$;

create function pg_temp.reject_test_income() returns trigger language plpgsql as $$
begin raise exception 'TEST_REVENUE_FAILURE'; end;
$$;
create trigger reject_test_income before insert on public.revenue_events
  for each row execute function pg_temp.reject_test_income();
do $$
declare oid uuid := '78000000-0000-4000-8000-000000000005'; job public.stripe_order_settlements%rowtype;
begin
  perform public.complete_stripe_order(oid, 'cs_test_5', 'pi_test_5');
  select * into job from public.claim_stripe_order_settlement('test', oid);
  perform public.prepare_stripe_order_operation(oid, job.lease_token, 'transfer',
    jsonb_build_object('amount',2544,'currency','eur','destination','acct_test','source_transaction','ch_test',
      'transfer_group','order_' || oid, 'metadata',jsonb_build_object('order_id',oid,
        'store_id','78000000-0000-4000-8000-000000000002','payment_intent_id','pi_test_5')),
    '{"seller_net_cents":2544,"processing_fee_cents":66,"platform_fee_net_cents":98,"platform_fee_vat_cents":24}');
  perform pg_temp.expect_error(format('select public.record_stripe_order_transfer(%L,%L,''tr_atomic_test'')', oid, job.lease_token),
    'TEST_REVENUE_FAILURE');
  perform pg_temp.assert_true((select stripe_transfer_id is null and stripe_seller_net_cents = 0 from public.orders where id = oid),
    'Failed income insert left a partially recorded transfer');
end;
$$;
drop trigger reject_test_income on public.revenue_events;
do $$
declare oid uuid := '78000000-0000-4000-8000-000000000005'; job public.stripe_order_settlements%rowtype;
begin
  select * into job from public.stripe_order_settlements where order_id = oid;
  perform public.record_stripe_order_transfer(oid, job.lease_token, 'tr_atomic_test');
  perform public.finish_stripe_order_settlement(oid, job.lease_token, 'completed');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_stripe_order_settlement('test', oid)), 'Completed transfer reclaimed');
  perform public.request_stripe_order_refund(oid, 'test');
  select * into job from public.claim_stripe_order_settlement('test', oid);
  perform public.finish_stripe_order_settlement(oid, job.lease_token, 'needs_review', 'Test failure');
  perform pg_temp.assert_true((select payment_status = 'paid' and stripe_refund_status = 'failed' from public.orders where id = oid),
    'Uncertain refund shown as completed');
end;
$$;

rollback;
