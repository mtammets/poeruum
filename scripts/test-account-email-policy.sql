create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end; $$;

update public.account_hygiene_settings set introduced_at = now();

select pg_temp.assert_true(public.email_domain_is_disposable('Random@MINITTS.NET'), 'Known disposable domain not detected');
select pg_temp.assert_true(public.email_domain_is_disposable('user@sub.tozya.com'), 'Subdomain bypass');
select pg_temp.assert_true(not public.email_domain_is_disposable('minitts.net@gmail.com'), 'Local part was classified');
select pg_temp.assert_true(not public.email_domain_is_disposable('user@notminitts.net'), 'Domain suffix boundary mismatch');
select pg_temp.assert_true(not public.email_domain_is_disposable('abc123@privaterelay.appleid.com'), 'Persistent alias blocked');
select pg_temp.assert_true(not public.email_domain_is_disposable('abc123@duck.com'), 'Persistent alias blocked');
select pg_temp.assert_true(not public.email_domain_is_disposable('abc123@example.invalid'), 'Unknown domain blocked');

insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('b1000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 'authenticated', 'authenticated',
  case when n = 1 then 'policy@minitts.net' else 'policy' || n || '@example.invalid' end,
  case when n in (1,2) then now() else null end, '{"provider":"email"}', '{}',
  case when n = 4 then now() else now() - interval '8 days' end, now()
from generate_series(1,12) n;
-- 1 disposable; 2 permanent; 3 eligible; 4 young; 5 signed in; 6 store;
-- 7 banned/evidence; 8 admin; 9 support; 10 stored file; 11 pending change; 12 activity.
update auth.users set last_sign_in_at = now() where id = 'b1000000-0000-4000-8000-000000000005';
update auth.users set banned_until = now() + interval '1 day' where id = 'b1000000-0000-4000-8000-000000000007';
update auth.users set raw_app_meta_data = '{"role":"admin"}' where id = 'b1000000-0000-4000-8000-000000000008';
update auth.users set email_change = 'new@example.invalid' where id = 'b1000000-0000-4000-8000-000000000011';
insert into public.support_conversations(user_id,subject,category) values ('b1000000-0000-4000-8000-000000000009','Keep support','question');
insert into storage.objects(bucket_id,name,owner_id) values ('product-images','policy-test/orphan.webp','b1000000-0000-4000-8000-000000000010');
update public.onboarding_journeys set last_activity_at = created_at + interval '2 minutes' where user_id = 'b1000000-0000-4000-8000-000000000012';
insert into public.stores(id,owner_id,name,slug,shipping,settings,payment_status,stripe_account_id,stripe_account_charges_enabled,stripe_account_payouts_enabled)
values ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Policy','email-policy-test',array['pickup'],
  '{"businessName":"Test","registryCode":"12345678","businessAddress":"Test 1","contactEmail":"test@example.invalid"}', 'connected','acct_policy',true,true),
  ('b2000000-0000-4000-8000-000000000006','b1000000-0000-4000-8000-000000000006','Keep store','email-policy-keep',array['pickup'],'{}','idle',null,false,false);
insert into public.products(id,store_id,name,description,image_url,price,slug) values
  ('email-policy-product','b2000000-0000-4000-8000-000000000001','Test','Test','https://example.invalid/a.jpg',10,'policy-product');

select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","user_metadata":{"email_verified":true}}',true);
set local role authenticated;
select pg_temp.assert_true(not (public.account_email_status()->>'activation_allowed')::boolean, 'Disposable account activated');
do $$ begin
  begin
    perform public.publish_store('b2000000-0000-4000-8000-000000000001');
    raise exception 'Disposable user published a store';
  exception when insufficient_privilege then null; end;
  begin perform public.cleanup_unconfirmed_accounts(false); raise exception 'Merchant invoked cleanup';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_signup_alerts(); raise exception 'Merchant accessed signup alerts';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_dashboard_users(); raise exception 'Merchant accessed admin email flags';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;

-- A pending new address cannot unlock activation. Only Auth's confirmed email is used.
update auth.users set email_change = 'permanent@example.invalid' where id = 'b1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.assert_true(not (public.account_email_status()->>'activation_allowed')::boolean, 'Pending change activated account');
reset role;
update auth.users set email = 'permanent@example.invalid', email_change = '', email_confirmed_at = now()
where id = 'b1000000-0000-4000-8000-000000000001';
set local role authenticated;
select public.publish_store('b2000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((public.account_email_status()->>'activation_allowed')::boolean, 'Confirmed permanent account stayed blocked');
reset role;
do $$ begin
  begin update auth.users set email = 'again@tozya.com' where id = 'b1000000-0000-4000-8000-000000000001';
    raise exception 'Activated merchant switched back to disposable';
  exception when insufficient_privilege then null; end;
  begin perform public.require_merchant_email('b1000000-0000-4000-8000-000000000003');
    raise exception 'Unconfirmed account activated';
  exception when insufficient_privilege then null; end;
end; $$;

select pg_temp.assert_true((public.cleanup_unconfirmed_accounts(false)->>'deleted')::int = 0, 'Rollout grace period ignored');
update public.account_hygiene_settings set introduced_at = now() - interval '8 days';
select public.cleanup_unconfirmed_accounts(true);
select pg_temp.assert_true(exists(select 1 from auth.users where id = 'b1000000-0000-4000-8000-000000000003'), 'Dry run deleted a user');
select public.cleanup_unconfirmed_accounts(false);
select pg_temp.assert_true(not exists(select 1 from auth.users where id = 'b1000000-0000-4000-8000-000000000003'), 'Eligible unconfirmed account not deleted');
select pg_temp.assert_true((select count(*) = 11 from auth.users where id::text like 'b1000000-%'), 'Protected account was deleted');


select public.observe_signup('{"metadata":{"ip_address":"192.0.2.100"}}') from generate_series(1,4);
select public.observe_signup('{"metadata":{"ip_address":"invalid-ip"}}');
reset role;
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000008","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from public.admin_signup_alerts()), 'Premature signup alert');
reset role;

select public.observe_signup('{"metadata":{"ip_address":"192.0.2.100"}}');
reset role;
set local role authenticated;
select pg_temp.assert_true(exists(select 1 from public.admin_signup_alerts() where requests = 5), 'Missing signup velocity alert');
select pg_temp.assert_true(exists(select 1 from public.admin_dashboard_users() where user_id = 'b1000000-0000-4000-8000-000000000002' and email_confirmed and not email_is_disposable), 'Admin flags incorrect');
reset role;
select pg_temp.assert_true(not has_function_privilege('anon','public.account_email_status(text)','execute'), 'Anonymous account lookup allowed');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.observe_signup(jsonb)','execute'), 'Client can forge signup observations');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.signup_observation_secret','select'), 'Hash salt exposed');

select pg_temp.assert_true(has_function_privilege('supabase_auth_admin','public.observe_signup(jsonb)','execute'), 'Auth cannot observe signups');
