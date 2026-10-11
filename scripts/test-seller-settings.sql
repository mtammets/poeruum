create function pg_temp.assert_seller(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end; $$;
create function pg_temp.reject_seller(statement text, message text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if position(message in sqlerrm)>0 then return; end if; raise; end;
  raise exception 'Expected rejection: %',message;
end; $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('81000000-0000-4000-8000-000000000001','authenticated','authenticated','seller-settings@example.invalid',now(),'{}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug,settings,shipping)
values('81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','Test','seller-settings-test',
'{"businessName":"Test OÜ","registryCode":"12345678","businessAddress":"Tallinn","contactEmail":"seller@example.invalid","storeAccent":"#123456"}',array['pickup']);
update public.stores set stripe_account_id='acct_seller_settings',stripe_account_mode='test',payment_provider='stripe'
where id='81000000-0000-4000-8000-000000000002';
select public.sync_store_payment_check(id,stripe_account_id,stripe_account_mode,settings,'{}',null,true)
from public.stores where id='81000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
update public.stores set settings=settings||'{"storeAccent":"#abcdef"}' where id='81000000-0000-4000-8000-000000000002';
select pg_temp.reject_seller($q$update public.stores set settings=settings||'{"businessName":"Pooleli"}' where id='81000000-0000-4000-8000-000000000002'$q$,'kinnitamise vormis');
select pg_temp.reject_seller($q$update public.stores set settings=settings||'{"registryCode":"87654321"}' where id='81000000-0000-4000-8000-000000000002'$q$,'kinnitamise vormis');
select pg_temp.reject_seller($q$update public.stores set settings=settings||'{"vatRegistered":true,"vatNumber":"EE123456789"}' where id='81000000-0000-4000-8000-000000000002'$q$,'kinnitamise vormis');
select pg_temp.reject_seller($q$update public.stores set settings=settings||'{"businessAddress":""}' where id='81000000-0000-4000-8000-000000000002'$q$,'puudulikud');
select pg_temp.reject_seller($q$update public.stores set settings=settings||'{"contactEmail":"invalid"}' where id='81000000-0000-4000-8000-000000000002'$q$,'puudulikud');
select pg_temp.reject_seller($q$select public.save_store_seller_details(null,null,null,null,null,null,true,'{}')$q$,'permission denied');
update public.stores set settings=settings||'{"contactEmail":"updated@example.invalid"}' where id='81000000-0000-4000-8000-000000000002';
reset role;
select pg_temp.assert_seller((select payment_status='connected' and settings->>'businessName'='Test OÜ' from public.stores where id='81000000-0000-4000-8000-000000000002'),'Rejected edit interrupted payments');
select pg_temp.assert_seller((select count(*)=1 from public.store_payment_checks where store_id='81000000-0000-4000-8000-000000000002'),'Rejected edit deleted verification');
select pg_temp.assert_seller(not has_function_privilege('anon','public.save_store_seller_details(uuid,uuid,jsonb,jsonb,text,text,boolean,jsonb)','EXECUTE'),'Anonymous RPC access');
select set_config('request.jwt.claim.role','service_role',true);
select pg_temp.assert_seller(has_function_privilege('service_role','public.save_store_seller_details(uuid,uuid,jsonb,jsonb,text,text,boolean,jsonb)','EXECUTE'),'Service cannot execute save RPC');
do $$ declare target public.stores%rowtype; expected jsonb; changed jsonb; result public.stores%rowtype;
begin
  select * into target from public.stores where id='81000000-0000-4000-8000-000000000002';
  expected:=public.store_seller_settings(target.settings);
  changed:=expected||'{"businessName":"Kinnitatud OÜ"}';
  perform pg_temp.reject_seller(format('select public.save_store_seller_details(%L,%L,%L,%L,%L,%L,null,null)',target.id,target.owner_id,expected,changed,target.stripe_account_id,target.stripe_account_mode),'STRIPE_VERIFICATION_REQUIRED');
  result:=public.save_store_seller_details(target.id,target.owner_id,expected,changed,target.stripe_account_id,target.stripe_account_mode,true,'{}');
  perform pg_temp.assert_seller(result.payment_status='connected' and result.settings->>'businessName'='Kinnitatud OÜ','Verified name did not commit with active payments');
  perform pg_temp.assert_seller(result.settings->>'storeAccent'='#abcdef','Unrelated settings lost');
  perform pg_temp.assert_seller((select identity=public.seller_identity_key(result.settings) from public.store_payment_checks where store_id=target.id),'Payment proof does not match saved seller');
  perform pg_temp.reject_seller(format('select public.save_store_seller_details(%L,%L,%L,%L,%L,%L,true,%L)',target.id,target.owner_id,expected,changed,target.stripe_account_id,target.stripe_account_mode,'{}'),'SELLER_CHANGED');
  expected:=public.store_seller_settings(result.settings);
  perform pg_temp.reject_seller(format('select public.save_store_seller_details(%L,%L,%L,%L,%L,%L,true,%L)',target.id,target.owner_id,expected,expected||'{"registryCode":"87654321"}',target.stripe_account_id,target.stripe_account_mode,'{}'),'SELLER_TRANSFER_REQUIRED');
  perform pg_temp.reject_seller(format('select public.save_store_seller_details(%L,%L,%L,%L,%L,%L,true,%L)',target.id,target.owner_id,expected,expected,'acct_replaced',target.stripe_account_mode,'{}'),'SELLER_CHANGED');
  perform pg_temp.reject_seller(format('select public.save_store_seller_details(%L,%L,%L,%L,%L,%L,null,null)',target.id,target.owner_id,expected,expected||'{"vatRegistered":true}',target.stripe_account_id,target.stripe_account_mode),'INVALID_SELLER_SETTINGS');
  result:=public.save_store_seller_details(target.id,target.owner_id,expected,expected||'{"vatRegistered":true,"vatNumber":"EE123456789"}',target.stripe_account_id,target.stripe_account_mode,null,null);
  perform pg_temp.assert_seller(result.payment_status='connected' and result.settings->'vatRegistered'='true'::jsonb,'VAT update interrupted payments');
end; $$;
reset role;
