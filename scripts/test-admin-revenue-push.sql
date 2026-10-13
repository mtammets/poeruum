-- Runs inside test-admin-push.sql's rollback transaction with dispatch disabled.
insert into public.stores(id,owner_id,name,slug) values
('95000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','Push fee test','push-fee-test');
insert into public.orders(id,store_id,order_number,items,customer_name,customer_email,delivery,product_subtotal,total,stripe_mode)
values ('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','PUSH-TEST','[]','Test','push@example.invalid','pickup',10,10,'test');

insert into public.revenue_events(id,provider,provider_event_id,kind,amount_cents,currency,description,occurred_at,metadata,store_id) values
('97000000-0000-4000-8000-000000000001','stripe','push-fee-live','transaction_fee',125,'eur','Fee',now(),'{}','95000000-0000-4000-8000-000000000001'),
('97000000-0000-4000-8000-000000000002','stripe','push-subscription-live','subscription',3900,'eur','Subscription',now(),'{"livemode":true}','95000000-0000-4000-8000-000000000001'),
('97000000-0000-4000-8000-000000000003','stripe','push-refund-live','transaction_fee_refund',-125,'eur','Refund',now(),'{}',null),
('97000000-0000-4000-8000-000000000004','stripe','push-fee-test','transaction_fee',125,'eur','Test fee',now(),'{"livemode":false}',null),
('97000000-0000-4000-8000-000000000005','stripe','push-mode-test','transaction_fee',125,'eur','Test mode',now(),'{"stripe_mode":"test"}',null),
('97000000-0000-4000-8000-000000000006','stripe','push-billing-adjustment','subscription',50,'eur','Adjustment',now(),'{"billing_adjustment":"credit_note"}',null),
('97000000-0000-4000-8000-000000000007','stripe','push-test-order','subscription',125,'eur','Old test order',now(),'{"order_id":"96000000-0000-4000-8000-000000000001"}',null);
select pg_temp.verify((select count(*)=4 from public.admin_push_jobs where kind='revenue'), 'Fees/subscriptions did not fan out or test payments/refunds triggered revenue push');
select pg_temp.verify((select bool_and(amount_cents=125 and currency='eur') from public.admin_push_jobs where event_id='97000000-0000-4000-8000-000000000001'), 'Fee amount or currency not snapshotted');
select pg_temp.verify((select bool_and(store_name='Push fee test') from public.admin_push_jobs where kind='revenue'), 'Shop name missing from fee or subscription snapshot');
insert into public.revenue_events(provider,provider_event_id,kind,amount_cents,currency,description,occurred_at)
values ('stripe','push-fee-live','transaction_fee',125,'eur','Duplicate webhook',now()) on conflict do nothing;
update public.revenue_events set amount_cents=900 where id='97000000-0000-4000-8000-000000000001';
update public.stores set name='Renamed shop' where id='95000000-0000-4000-8000-000000000001';
select pg_temp.verify((select count(*)=4 from public.admin_push_jobs where kind='revenue'), 'Duplicate webhook or row update repeated the notification');

update public.admin_push_subscriptions set revenue_enabled=false where id='92000000-0000-4000-8000-000000000001';
select pg_temp.verify((select count(*)=2 from public.admin_push_jobs where kind='revenue'), 'Muting revenue did not prune only this device');
select pg_temp.verify((select count(*)=4 from public.admin_push_jobs where kind in ('visit','account')), 'Muting revenue affected other categories');
insert into public.revenue_events(provider,provider_event_id,kind,amount_cents,currency,description,occurred_at)
values ('stripe','push-fee-cent','transaction_fee',1,'eur','Small fee',now());
select pg_temp.verify((select count(*)=3 from public.admin_push_jobs where kind='revenue'), 'Revenue preference ignored on enqueue');
select pg_temp.verify((select store_name='Pood' from public.admin_push_jobs where kind='revenue' and amount_cents=1), 'Revenue without a shop has no fallback name');
select pg_temp.verify(not exists(select 1 from public.admin_push_jobs where kind='revenue' and subscription_id='92000000-0000-4000-8000-000000000001'), 'Muted device receives fee notifications');

update public.admin_push_jobs set available_at=now()+interval '1 minute';
update public.admin_push_jobs set available_at=now() where event_id='97000000-0000-4000-8000-000000000001';
do $$ declare first_job record; retry_job record;
begin
  select * into first_job from public.claim_admin_push_job();
  perform pg_temp.verify(first_job.kind='revenue' and first_job.amount_cents=125 and first_job.currency='eur'
    and first_job.store_name='Push fee test', 'Claim lost the original shop or fee snapshot');
  perform pg_temp.verify(public.finish_admin_push_job(first_job.id,first_job.lease_token,'retry'), 'Revenue retry failed');
  update public.admin_push_jobs set available_at=now() where id=first_job.id;
  select * into retry_job from public.claim_admin_push_job();
  perform pg_temp.verify(retry_job.id=first_job.id and retry_job.lease_token<>first_job.lease_token
    and retry_job.amount_cents=125 and retry_job.currency='eur' and retry_job.store_name='Push fee test', 'Revenue retry changed identity, lease, shop or amount');
  perform pg_temp.verify(public.finish_admin_push_job(retry_job.id,retry_job.lease_token,'sent'), 'Revenue completion failed');
end; $$;

update public.admin_push_subscriptions set revenue_enabled=false;
select pg_temp.verify(not exists(select 1 from public.admin_push_jobs where kind='revenue'), 'Muting revenue left queued work');
insert into public.admin_push_jobs(subscription_id,event_id,kind,amount_cents,currency)
values ('92000000-0000-4000-8000-000000000001',gen_random_uuid(),'revenue',125,'eur');
select pg_temp.verify(not exists(select 1 from public.claim_admin_push_job()), 'Worker claimed disabled revenue');
update public.admin_push_subscriptions set revenue_enabled=true;
select pg_temp.verify(not exists(select 1 from public.admin_push_jobs where kind='revenue'), 'Re-enabling revenue backfilled past fees');
