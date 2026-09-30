\set ON_ERROR_STOP on
create function pg_temp.seller_assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end;
$$;
create function pg_temp.seller_error(statement text, message text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if position(message in sqlerrm)>0 then return; end if; raise; end;
  raise exception 'Expected error: %',message;
end;
$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('78000000-0000-4000-8000-000000000001','authenticated','authenticated','seller-test@example.com',now(),'{}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug,settings,shipping)
values('78000000-0000-4000-8000-000000000002','78000000-0000-4000-8000-000000000001','Liisa ateljee','entrepreneur-seller-test',
'{"sellerType":"entrepreneur","sellerFirstName":"Liisa","sellerLastName":"Tamm","businessAddress":"Tartu","contactEmail":"liisa@example.com","registryCode":"PRIVATE_ID"}',array['pickup']);
insert into public.products(id,store_id,name,image_url,price,stock)
values('entrepreneur-test-art','78000000-0000-4000-8000-000000000002','Akvarell','',65,5);
do $$ declare settings_value jsonb;
begin
  select settings into settings_value from public.stores where id='78000000-0000-4000-8000-000000000002';
  perform pg_temp.seller_assert(public.seller_details_complete(settings_value),'Valid individual blocked');
  perform pg_temp.seller_assert(settings_value->>'registryCode'='' and settings_value->>'businessName'='Liisa Tamm','Private registry field leaked or name missing');
  perform pg_temp.seller_assert(public.seller_details_complete(settings_value||'{"entrepreneurAccountConfirmed":false}'::jsonb),'Legacy unchecked confirmation blocked seller');
  perform pg_temp.seller_assert(not public.seller_details_complete(settings_value-'sellerLastName'),'Missing last name accepted');
  perform pg_temp.seller_assert(not public.seller_details_complete(settings_value||'{"sellerType":"unknown"}'::jsonb),'Unknown type accepted');
  perform pg_temp.seller_assert(not public.seller_details_complete(settings_value||'{"sellerType":"company"}'::jsonb),'Company registry requirement bypassed');
  perform pg_temp.seller_error($q$update public.stores set settings=settings||'{"vatRegistered":true}' where id='78000000-0000-4000-8000-000000000002'$q$,'käibemaksukohustuslane');
end; $$;
update public.stores set payment_provider='stripe',payment_status='connected',stripe_account_id='acct_local_entrepreneur',
  stripe_account_charges_enabled=true,stripe_account_payouts_enabled=true,stripe_account_mode='test'
where id='78000000-0000-4000-8000-000000000002';
select pg_temp.seller_error($q$update public.stores set settings=settings||'{"sellerType":"company"}' where id='78000000-0000-4000-8000-000000000002'$q$,'Müüja tüübi muutmiseks');
insert into public.store_payment_checks(store_id,account_id,stripe_mode,identity,stripe_ready,verified_at)
select id,stripe_account_id,stripe_account_mode,public.seller_identity_key(settings),true,now() from public.stores where id='78000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.publish_store('78000000-0000-4000-8000-000000000002');
reset role;
do $$ declare target public.orders%rowtype; receipt public.order_documents%rowtype; credit public.order_documents%rowtype;
  snapshot_value jsonb:='{"version":1,"currency":"eur","seller":{"type":"entrepreneur","name":"Liisa Tamm","registryCode":"","address":"Tartu","email":"liisa@example.com","vatNumber":""},"buyer":{"name":"Mari","address":"Tallinn","email":"mari@example.com"},"lines":[{"name":"Akvarell","quantity":1,"unitGrossCents":6500,"grossCents":6500,"netCents":6500,"vatCents":0}],"vatRate":null,"netCents":6500,"vatCents":0,"totalCents":6500}';
begin
  target:=public.create_invoiced_stripe_order('78000000-0000-4000-8000-000000000002','entrepreneur-checkout-1','PR-ENTREPRENEUR',
    '[{"id":"entrepreneur-test-art","name":"Akvarell","price":65,"quantity":1}]','Mari','mari@example.com','Tulen ise järele',65,65,'test',now()+interval '35 minutes',snapshot_value);
  perform public.complete_invoiced_stripe_order(target.id,'cs_entrepreneur','pi_entrepreneur',now());
  select * into receipt from public.order_documents where order_id=target.id and kind='invoice';
  perform pg_temp.seller_assert(receipt.snapshot#>>'{seller,type}'='entrepreneur','Receipt lost seller type');
  perform pg_temp.seller_assert(receipt.snapshot#>>'{seller,registryCode}'='','Receipt has a registry code');
  update public.stores set settings=settings||'{"sellerFirstName":"Muudetud"}' where id=target.store_id;
  update public.orders set payment_status='refunded',status='refunded',stripe_refund_status='succeeded' where id=target.id;
  select * into credit from public.order_documents where order_id=target.id and kind='credit';
  perform pg_temp.seller_assert(credit.snapshot=receipt.snapshot and credit.original_number=receipt.number,'Return proof lost the original seller identity');
end; $$;
