\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end;
$$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('79000000-0000-4000-8000-000000000001','authenticated','authenticated','recovery@example.invalid','{}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug) values('79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000001','Recovery','recovery-test');
insert into public.products(id,store_id,name,price,image_url,stock)
values('recovery-product','79000000-0000-4000-8000-000000000002','Recovery product',10,'https://example.invalid/image.jpg',1);
insert into public.orders(id,store_id,order_number,items,customer_name,customer_email,delivery,product_subtotal,total,payment_status,stripe_mode,checkout_request_id,reservation_expires_at)
select ('79000000-0000-4000-8000-00000000000'||n)::uuid,'79000000-0000-4000-8000-000000000002','PR-RECOVERY-'||n,
  '[{"id":"recovery-product","quantity":1}]','Test','test@example.invalid','Pickup',10,10,'pending','test','recovery-request-'||n,now()+interval '35 minutes'
from generate_series(3,6) n;

do $$
declare target uuid := '79000000-0000-4000-8000-000000000003'; payload jsonb; attempt public.stripe_checkout_attempts; job public.order_payment_recovery;
  old_token uuid; claim jsonb; webhook_token uuid; fn regprocedure; result public.orders;
begin
  foreach fn in array array['public.prepare_stripe_checkout(uuid,jsonb)'::regprocedure,'public.bind_stripe_checkout(uuid,text,text)'::regprocedure,
    'public.release_verified_stripe_order(uuid,text)'::regprocedure,'public.release_absent_stripe_checkout(uuid,timestamptz)'::regprocedure,
    'public.claim_order_payment_recovery(text)'::regprocedure,'public.finish_order_payment_recovery(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure,
    'public.repair_paid_order_jobs(uuid)'::regprocedure,'public.claim_stripe_webhook(text,text,text,boolean,text,jsonb)'::regprocedure,
    'public.claim_stored_stripe_webhook(text)'::regprocedure,'public.finish_stripe_webhook(text,uuid,text,text)'::regprocedure] loop
    perform pg_temp.assert_true(not has_function_privilege('anon',fn,'execute') and not has_function_privilege('authenticated',fn,'execute')
      and has_function_privilege('service_role',fn,'execute'),'Client recovery access or missing service access: '||fn::text);
  end loop;
  perform pg_temp.assert_true(not has_table_privilege('authenticated','public.stripe_checkout_attempts','select')
    and not has_table_privilege('anon','public.order_payment_recovery','select'),'Recovery data exposed');
  perform pg_temp.assert_true((select count(*)=4 from public.order_payment_recovery where stripe_mode='test'),'Order creation lost a recovery job');
  update public.orders set payment_status='failed' where id<>target;
  payload := jsonb_build_object('mode','payment','expires_at',extract(epoch from now()+interval '30 minutes')::bigint,
    'metadata',jsonb_build_object('order_id',target,'store_id','79000000-0000-4000-8000-000000000002','stripe_mode','test'));
  attempt := public.prepare_stripe_checkout(target,payload);
  perform pg_temp.assert_true((public.prepare_stripe_checkout(target,payload||'{"expires_at":1}')).payload=payload,'Retry changed Stripe request');
  update public.orders set reservation_expires_at=now()-interval '1 hour' where id=target;
  perform public.release_stripe_order(target);
  perform public.release_expired_unstarted_stripe_orders();
  perform pg_temp.assert_true((select payment_status='pending' from public.orders where id=target),'Uncertain outbound request released stock');
  begin
    perform public.create_stripe_order_with_reservation('79000000-0000-4000-8000-000000000002','another-recovery-request','PR-EXTRA',
      '[{"id":"recovery-product","quantity":1}]','Test','test@example.invalid','Pickup',10,10,'test',now()+interval '35 minutes');
    raise exception 'Uncertain checkout allowed overselling';
  exception when others then if sqlerrm not like '%INSUFFICIENT_STOCK:%' then raise; end if; end;
  begin
    perform public.release_absent_stripe_checkout(target,now()); raise exception 'Premature absence released stock';
  exception when others then if sqlerrm<>'CHECKOUT_RESULT_UNCERTAIN' then raise; end if; end;
  perform public.bind_stripe_checkout(target,'cs_recovery','test');
  begin
    perform public.bind_stripe_checkout(target,'cs_other','test'); raise exception 'Checkout binding overwritten';
  exception when others then if sqlerrm<>'ORDER_PAYMENT_MISMATCH' then raise; end if; end;
  begin
    perform public.release_verified_stripe_order(target,'cs_other'); raise exception 'Old event freed current reservation';
  exception when others then if sqlerrm<>'ORDER_PAYMENT_MISMATCH' then raise; end if; end;

  update public.order_payment_recovery set next_attempt_at=now()-interval '1 day' where order_id=target;
  select * into job from public.claim_order_payment_recovery('test'); old_token:=job.lease_token;
  perform pg_temp.assert_true(job.order_id=target,'Wrong recovery claim');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_order_payment_recovery('test')),'Active lease claimed twice');
  update public.order_payment_recovery set lease_expires_at=now()-interval '1 second' where order_id=target;
  select * into job from public.claim_order_payment_recovery('test');
  begin
    perform public.finish_order_payment_recovery(target,old_token,'completed'); raise exception 'Expired worker saved';
  exception when others then if sqlerrm<>'RECOVERY_LEASE_LOST' then raise; end if; end;
  perform public.finish_order_payment_recovery(target,job.lease_token,'pending',null,'cs_cursor','cs_match',now());
  perform pg_temp.assert_true((select scan_cursor='cs_cursor' and scan_match_id='cs_match' from public.order_payment_recovery where order_id=target),'Lost scan progress');

  perform public.complete_stripe_order(target,'cs_recovery','pi_recovery');
  perform public.complete_stripe_order(target,'cs_recovery','pi_recovery');
  perform public.release_verified_stripe_order(target,'cs_recovery');
  perform pg_temp.assert_true((select payment_status='paid' from public.orders where id=target),'Late failure released paid order');
  perform pg_temp.assert_true((select stock=0 from public.products where id='recovery-product'),'Retry changed stock twice');
  update public.order_email_jobs set status='accepted',accepted_at=now(),resend_email_id='email_recovery' where order_id=target and kind='customer';
  update public.stripe_order_settlements set status='completed',completed_at=now() where order_id=target;
  perform public.repair_paid_order_jobs(target);
  perform pg_temp.assert_true((select status='accepted' and resend_email_id='email_recovery' from public.order_email_jobs where order_id=target and kind='customer'),'Accepted email reset');
  perform pg_temp.assert_true((select status='completed' from public.stripe_order_settlements where order_id=target),'Completed transfer reset');
  delete from public.order_email_jobs where order_id=target and kind='seller';
  perform public.repair_paid_order_jobs(target);
  perform pg_temp.assert_true((select status='needs_review' and legacy_import from public.order_email_jobs where order_id=target and kind='seller'),'Unknown legacy email automatically resent');
  update public.orders set payment_status='refunded' where id=target;
  perform public.complete_stripe_order(target,'cs_recovery','pi_recovery');
  result:=public.create_stripe_order_with_reservation('79000000-0000-4000-8000-000000000002','recovery-request-3','PR-RENEW',
    '[{"id":"recovery-product","quantity":1}]','Test','test@example.invalid','Pickup',10,10,'test',now()+interval '35 minutes');
  perform pg_temp.assert_true(result.payment_status='refunded','Retry reopened refunded order');

  payload:='{"id":"evt_recovery","type":"checkout.session.completed","livemode":false,"data":{"object":{"mode":"payment"}}}';
  claim:=public.claim_stripe_webhook('evt_recovery','account','checkout.session.completed',false,null,payload);
  webhook_token:=(claim->>'token')::uuid;
  perform pg_temp.assert_true(claim->>'state'='claimed','First event not claimed');
  perform pg_temp.assert_true(public.claim_stripe_webhook('evt_recovery','account','checkout.session.completed',false,null,payload)->>'state'='busy','In-flight event marked duplicate');
  update public.stripe_webhook_events set lease_expires_at=now()-interval '1 second' where event_id='evt_recovery';
  claim:=public.claim_stripe_webhook('evt_recovery','account','checkout.session.completed',false,null,payload);
  begin
    perform public.finish_stripe_webhook('evt_recovery',webhook_token,'completed'); raise exception 'Stale webhook worker saved';
  exception when others then if sqlerrm<>'WEBHOOK_LEASE_LOST' then raise; end if; end;
  perform public.finish_stripe_webhook('evt_recovery',(claim->>'token')::uuid,'retry','DB unavailable');
  perform pg_temp.assert_true((select processed_at is null and stripe_webhook_events.payload is not null and recovery_status='retry' from public.stripe_webhook_events where event_id='evt_recovery'),'Failure deleted event or claimed completion');
  update public.stripe_webhook_events set next_attempt_at=now() where event_id='evt_recovery';
  select lease_token into webhook_token from public.claim_stored_stripe_webhook('test') where event_id='evt_recovery';
  perform pg_temp.assert_true(webhook_token is not null,'Stored event not recovered automatically');
  perform public.finish_stripe_webhook('evt_recovery',webhook_token,'completed');
  perform pg_temp.assert_true(public.claim_stripe_webhook('evt_recovery','account','checkout.session.completed',false,null,payload)->>'state'='processed','Completed event not recognized');
end;
$$;
rollback;
