-- Runs in the entrepreneur seller suite's rollback transaction.
select pg_temp.seller_assert(not has_table_privilege('authenticated','public.stripe_oauth_attempts','SELECT'), 'OAuth state is publicly readable');
select pg_temp.seller_assert(not has_function_privilege('authenticated','public.attach_stripe_oauth_account(text,uuid,text,text,jsonb)','EXECUTE'), 'Merchant can self-attach payout account');
select pg_temp.seller_assert(not has_column_privilege('authenticated','public.stores','stripe_connection_type','UPDATE'), 'Merchant can alter account type');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('78000000-0000-4000-8000-000000000003','authenticated','authenticated','oauth-test@example.com',now(),'{}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug,settings)
select '78000000-0000-4000-8000-000000000004','78000000-0000-4000-8000-000000000003','OAuth test','stripe-oauth-test',settings
from public.stores where id='78000000-0000-4000-8000-000000000002';
insert into public.stripe_oauth_attempts(state_hash,store_id,owner_id,stripe_mode,settings_snapshot)
select repeat('a',64),id,owner_id,'test',settings from public.stores where id='78000000-0000-4000-8000-000000000004';
do $$ declare claims integer;
begin
  update public.stripe_oauth_attempts set consumed_at=now() where state_hash=repeat('a',64) and owner_id='78000000-0000-4000-8000-000000000001' and consumed_at is null;
  get diagnostics claims = row_count;
  perform pg_temp.seller_assert(claims=0,'Another owner consumed state');
  update public.stripe_oauth_attempts set consumed_at=now() where state_hash=repeat('a',64) and owner_id='78000000-0000-4000-8000-000000000003' and consumed_at is null;
  get diagnostics claims = row_count;
  perform pg_temp.seller_assert(claims=1,'Owner cannot claim state');
  update public.stripe_oauth_attempts set consumed_at=now() where state_hash=repeat('a',64) and consumed_at is null;
  get diagnostics claims = row_count;
  perform pg_temp.seller_assert(claims=0,'Replay would exchange token twice');
end; $$;
select pg_temp.seller_error($q$select public.attach_stripe_oauth_account(repeat('a',64),'78000000-0000-4000-8000-000000000003','acct_oauthtest','live','{}')$q$,'aegus');
update public.stores set settings=settings||'{"businessAddress":"Uus"}' where id='78000000-0000-4000-8000-000000000004';
select pg_temp.seller_error($q$select public.attach_stripe_oauth_account(repeat('a',64),'78000000-0000-4000-8000-000000000003','acct_oauthtest','test','{}')$q$,'muutusid');
update public.stripe_oauth_attempts set settings_snapshot=(select settings from public.stores where id=store_id);
select public.attach_stripe_oauth_account(repeat('a',64),'78000000-0000-4000-8000-000000000003','acct_oauthtest','test','{"ready":false,"chargesEnabled":true,"payoutsEnabled":true}');
select pg_temp.seller_assert((select payment_status='pending' and stripe_connection_type='oauth' from public.stores where id='78000000-0000-4000-8000-000000000004'),'Account incorrectly marked ready');
select pg_temp.seller_error($q$select public.attach_stripe_oauth_account(repeat('a',64),'78000000-0000-4000-8000-000000000003','acct_other','test','{}')$q$,'aegus');
-- A second store cannot claim the same external account. A linked account is not replaced.
insert into public.stripe_oauth_attempts(state_hash,store_id,owner_id,stripe_mode,settings_snapshot,consumed_at)
select repeat('b',64),id,owner_id,'test',settings,now() from public.stores where id='78000000-0000-4000-8000-000000000002';
select pg_temp.seller_error($q$select public.attach_stripe_oauth_account(repeat('b',64),'78000000-0000-4000-8000-000000000001','acct_oauthtest','test','{}')$q$,'juba ühendatud');
update public.stores set stripe_account_id=null where id='78000000-0000-4000-8000-000000000002';
select pg_temp.seller_error($q$select public.attach_stripe_oauth_account(repeat('b',64),'78000000-0000-4000-8000-000000000001','acct_oauthtest','test','{}')$q$,'teise poega');
