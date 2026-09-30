\set ON_ERROR_STOP on
begin;
create function pg_temp.verify(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end; $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('79000000-0000-4000-8000-000000000001','authenticated','authenticated','safeguards@example.invalid','{"role":"admin"}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug,settings,stripe_account_id,stripe_account_mode)
values('79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000001','Safeguards','safeguards-test',
'{"sellerType":"entrepreneur","sellerFirstName":"Liisa","sellerLastName":"Tamm","businessAddress":"Tartu","contactEmail":"liisa@example.com"}','acct_test','test');
insert into public.orders(id,store_id,order_number,items,customer_name,customer_email,delivery,product_subtotal,total,payment_status,stripe_mode,stripe_payment_intent_id,stripe_transfer_id,invoice_snapshot)
values('79000000-0000-4000-8000-000000000003','79000000-0000-4000-8000-000000000002','PR-SAFEGUARDS','[]','Test','buyer@example.invalid','Pickup',100,100,'paid','test','pi_test','tr_test','{"version":1,"currency":"eur","seller":{"type":"entrepreneur","name":"Liisa Tamm","registryCode":"","address":"Tartu","email":"liisa@example.com","vatNumber":""},"buyer":{"name":"Test","address":"Tallinn","email":"buyer@example.invalid"},"lines":[{"name":"Test","quantity":1,"unitGrossCents":10000,"grossCents":10000,"netCents":10000,"vatCents":0}],"vatRate":null,"netCents":10000,"vatCents":0,"totalCents":10000}');
do $$
declare oid uuid:='79000000-0000-4000-8000-000000000003'; sid uuid:='79000000-0000-4000-8000-000000000002'; job public.stripe_order_settlements%rowtype;
  settings_value jsonb; bank_value jsonb:='{"id":"ba_test","country":"EE","currency":"eur","fingerprint":"fp_test","last4":"1234"}';
begin
  perform pg_temp.verify(not has_table_privilege('anon','public.store_payment_checks','select') and not has_table_privilege('authenticated','public.store_payment_checks','select'),'Payout evidence is public');
  perform pg_temp.verify(not has_function_privilege('authenticated','public.approve_entrepreneur_payout(uuid,text,text,uuid)','execute'),'Seller can approve their own account');
  perform pg_temp.verify(not has_function_privilege('authenticated','public.observe_stripe_order_payment(uuid,text,integer,text,text,text,text)','execute'),'Seller can forge Stripe state');
  perform pg_temp.verify(not has_function_privilege('authenticated','public.retry_funded_stripe_refund(uuid)','execute'),'Seller can bypass refund hold');
  perform pg_temp.verify(not has_column_privilege('authenticated','public.orders','stripe_payment_issue','update'),'Seller can clear review');
  perform pg_temp.verify((select status='completed' from public.stripe_order_settlements where order_id=oid),'Fixture must already be settled');
  perform public.observe_stripe_order_payment(oid,'test',500,null,null,null);
  perform pg_temp.verify((select stripe_payment_issue='partial_refund' and payment_status='paid' from public.orders where id=oid),'Partial refund invisible or incorrectly full');
  perform pg_temp.verify(not exists(select 1 from public.claim_stripe_order_settlement('test',oid)),'Partial refund not held');
  perform public.observe_stripe_order_payment(oid,'test',10000,'re_external');
  perform pg_temp.verify((select payment_status='refunded' and stripe_refund_status='succeeded' from public.orders where id=oid),'External full refund not recorded');
  perform pg_temp.verify((select count(*)=1 from public.order_documents where order_id=oid and kind='credit'),'Full refund did not issue exactly one credit document');
  select * into job from public.claim_stripe_order_settlement('test',oid);
  perform pg_temp.verify(job.lease_token is not null,'Completed settlement was not reopened');
  perform public.finish_stripe_order_settlement(oid,job.lease_token,'needs_review','FUNDS_REQUIRED:reversal: balance_insufficient');
  perform pg_temp.verify((select stripe_payment_issue='funds_required' and stripe_refund_status='succeeded' and payment_status='refunded' from public.orders where id=oid),'Recovery failure hid customer refund');
  perform public.retry_funded_stripe_refund(oid);
  perform pg_temp.verify((select funding_retry_count=1 from public.stripe_order_settlements where order_id=oid),'Controlled retry did not renew the known-failed idempotency key');
  select * into job from public.claim_stripe_order_settlement('test',oid);
  perform public.finish_stripe_order_settlement(oid,job.lease_token,'refunded',null,'re_external');
  perform public.observe_stripe_order_payment(oid,'test',10000,'re_external');
  perform pg_temp.verify(not exists(select 1 from public.claim_stripe_order_settlement('test',oid)),'Duplicate refund reopened completed recovery');
  perform public.observe_stripe_order_payment(oid,'test',0,null,'dp_test','needs_response');
  perform pg_temp.verify((select stripe_payment_issue='dispute' and payment_status='refunded' from public.orders where id=oid),'Dispute lost refunded truth');
  select settings into settings_value from public.stores where id=sid;
  perform pg_temp.verify(not public.sync_store_payment_check(sid,'acct_test','test',settings_value,bank_value,null,true),'Unreviewed entrepreneur was activated');
  perform public.approve_entrepreneur_payout(sid,'ba_test','MTA and complete IBAN verified; private evidence reference TEST','79000000-0000-4000-8000-000000000001');
  perform pg_temp.verify(public.sync_store_payment_check(sid,'acct_test','test',settings_value,bank_value,null,true),'Approval not retained for same account');
  update public.stores set name='New shop brand' where id=sid;
  perform pg_temp.verify((select payment_status='connected' from public.stores where id=sid),'Shop brand invalidated legal identity');
  perform pg_temp.verify(not public.sync_store_payment_check(sid,'acct_test','test',settings_value,bank_value||'{"id":"ba_changed","fingerprint":"other"}',null,true),'Changed bank retained approval');
  perform pg_temp.verify((select verified_at is null and evidence is null from public.store_payment_checks where store_id=sid),'Old evidence reused for new bank');
  perform public.sync_store_payment_check(sid,'acct_test','test',settings_value,bank_value,null,true);
  perform public.approve_entrepreneur_payout(sid,'ba_test','MTA and complete IBAN verified again; TEST','79000000-0000-4000-8000-000000000001');
  update public.stores set settings=settings||'{"sellerFirstName":"Jaan"}' where id=sid;
  perform pg_temp.verify((select payment_status='pending' from public.stores where id=sid),'Changed seller stayed connected');
  perform pg_temp.verify(not exists(select 1 from public.store_payment_checks where store_id=sid),'Changed seller retained bank verification');
  begin
    perform public.sync_store_payment_check(sid,'acct_test','test',settings_value,bank_value,null,true);
    raise exception 'Stale identity reconnected';
  exception when others then if sqlerrm<>'SELLER_CHANGED' then raise; end if; end;
end; $$;
set local role authenticated;
select set_config('request.jwt.claims','{"app_metadata":{}}',true);
do $$ begin
  begin perform public.admin_payment_reviews(); raise exception 'Non-admin accessed reviews';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
rollback;
