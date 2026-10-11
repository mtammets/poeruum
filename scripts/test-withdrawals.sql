create function pg_temp.assert_withdrawal(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end; $$;
create function pg_temp.reject_withdrawal(statement text, message text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if position(message in sqlerrm)>0 then return; end if; raise; end;
  raise exception 'Expected rejection: %',message;
end; $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('82000000-0000-4000-8000-000000000001','authenticated','authenticated','withdrawal-owner@example.invalid','{}','{}',now(),now()),
('82000000-0000-4000-8000-000000000009','authenticated','authenticated','other-withdrawal-owner@example.invalid','{}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug) values
('82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','Withdrawal test','withdrawal-test');
insert into public.orders(id,store_id,order_number,items,customer_name,customer_email,delivery,product_subtotal,total,payment_status,stripe_mode)
values('82000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000002','PR-WITHDRAWAL','[]','Buyer','buyer@example.invalid','Pickup',10,10,'pending','test');
select pg_temp.assert_withdrawal(not has_table_privilege('anon','public.store_withdrawals','select')
  and not has_table_privilege('authenticated','public.store_withdrawals','insert')
  and not has_table_privilege('authenticated','public.store_withdrawals','update'),'Public access to declarations');
select pg_temp.assert_withdrawal(not has_function_privilege('authenticated','public.submit_store_withdrawal(uuid,uuid,uuid,text,text,text,text,text,text,text)','execute')
  and not has_function_privilege('anon','public.claim_withdrawal_email(text,uuid)','execute'),'Queue accessible to clients');
select public.submit_store_withdrawal('82000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000003',
  'PR-WITHDRAWAL','Buyer','different-mailbox@example.invalid','Sinine kruus','Withdrawal test','seller@example.invalid','test');
select public.submit_store_withdrawal('82000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000003',
  'PR-WITHDRAWAL','Buyer','different-mailbox@example.invalid','Sinine kruus','Changed store name','changed-seller@example.invalid','test');
select pg_temp.assert_withdrawal((select count(*)=2 from public.withdrawal_email_jobs where withdrawal_id='82000000-0000-4000-8000-000000000004'),'Retry duplicated email jobs');
select pg_temp.assert_withdrawal((select store_name='Withdrawal test' and seller_email='seller@example.invalid' and statement like '%Sinine kruus%' from public.store_withdrawals where id='82000000-0000-4000-8000-000000000004'),'Retry altered durable declaration');
select pg_temp.reject_withdrawal($q$select public.submit_store_withdrawal('82000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000002',null,
  'PR-CHANGED','Buyer','different-mailbox@example.invalid','','Test','seller@example.invalid','test')$q$,'WITHDRAWAL_REQUEST_CHANGED');
select public.submit_store_withdrawal('82000000-0000-4000-8000-000000000005','82000000-0000-4000-8000-000000000002',null,
  'Vana tellimus','Buyer','buyer@example.invalid','','Withdrawal test','seller@example.invalid','test');
select pg_temp.assert_withdrawal((select payment_status='pending' and stripe_refund_status is null from public.orders where id='82000000-0000-4000-8000-000000000003'),'Declaration changed payment/refund state');
select pg_temp.assert_withdrawal(public.closed_storefront_branding('withdrawal-test',null)->>'withdrawalSlug'='withdrawal-test','Closed shop lost withdrawal entry');
select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000009',true);
set local role authenticated;
select pg_temp.assert_withdrawal((select count(*)=0 from public.store_withdrawals),'Other owner can read declarations');
select pg_temp.reject_withdrawal($q$select public.review_store_withdrawal('82000000-0000-4000-8000-000000000004')$q$,'WITHDRAWAL_NOT_FOUND');
reset role;
select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.assert_withdrawal((select count(*)=2 from public.store_withdrawals),'Owner cannot read declarations');
select public.review_store_withdrawal('82000000-0000-4000-8000-000000000004');
reset role;
do $$
declare job public.withdrawal_email_jobs%rowtype; other_job public.withdrawal_email_jobs%rowtype; payload jsonb; original_token uuid;
begin
  select * into job from public.claim_withdrawal_email('live','82000000-0000-4000-8000-000000000004');
  perform pg_temp.assert_withdrawal(job.id is null,'Live worker claimed test mail');
  select * into job from public.claim_withdrawal_email('test','82000000-0000-4000-8000-000000000004');
  original_token:=job.lease_token;
  select * into other_job from public.claim_withdrawal_email('test','82000000-0000-4000-8000-000000000004');
  perform pg_temp.assert_withdrawal(job.id<>other_job.id,'Active lease was double claimed');
  perform pg_temp.assert_withdrawal((select count(*)=0 from public.claim_withdrawal_email('test','82000000-0000-4000-8000-000000000004')),'Leased jobs claimed again');
  payload:=jsonb_build_object('from','Poeruum <teavitused@send.poeruum.ee>','to',jsonb_build_array(case job.kind when 'customer' then 'different-mailbox@example.invalid' else 'seller@example.invalid' end),
    'subject','Declaration','text','Immutable declaration and timestamp','html','<p>Declaration</p>',
    'tags',jsonb_build_array(jsonb_build_object('name','withdrawal_email_job_id','value',job.id::text)));
  perform pg_temp.reject_withdrawal(format('select public.prepare_withdrawal_email(%L,%L,%L)',job.id,job.lease_token,payload||'{"to":["attacker@example.invalid"]}'),'INVALID_EMAIL_PAYLOAD');
  job:=public.prepare_withdrawal_email(job.id,job.lease_token,payload);
  perform pg_temp.assert_withdrawal(job.payload=payload and job.first_attempt_at is not null,'Payload not durable before send');
  job:=public.finish_withdrawal_email(job.id,job.lease_token,'retry',null,'timeout');
  update public.withdrawal_email_jobs set next_attempt_at=now()-interval '1 second' where id=job.id;
  select * into job from public.claim_withdrawal_email('test','82000000-0000-4000-8000-000000000004');
  perform pg_temp.assert_withdrawal(job.lease_token<>original_token and job.payload=payload,'Retry lost immutable payload');
  perform pg_temp.reject_withdrawal(format('select public.finish_withdrawal_email(%L,%L,%L)',job.id,original_token,'retry'),'EMAIL_LEASE_LOST');
  perform public.record_withdrawal_email_delivery(job.id,'resend-withdrawal-fixture',payload#>>'{to,0}','delivered',now());
  job:=public.finish_withdrawal_email(job.id,job.lease_token,'retry',null,'late timeout');
  perform pg_temp.assert_withdrawal(job.status='accepted' and job.resend_email_id='resend-withdrawal-fixture','Late timeout overwrote delivered state');
  perform pg_temp.reject_withdrawal(format('select public.record_withdrawal_email_delivery(%L,%L,%L,%L,now())',job.id,'other-provider-id',payload#>>'{to,0}','sent'),'EMAIL_EVENT_MISMATCH');
end; $$;

-- Retention/account cleanup must not leave new personal-data copies behind.
delete from public.orders where id='82000000-0000-4000-8000-000000000003';
select pg_temp.assert_withdrawal(not exists(select 1 from public.store_withdrawals where id='82000000-0000-4000-8000-000000000004'), 'Deleted order left its declaration');
update public.stores set owner_id=null where id='82000000-0000-4000-8000-000000000002';
select pg_temp.assert_withdrawal(not exists(select 1 from public.store_withdrawals where store_id='82000000-0000-4000-8000-000000000002'), 'Closed account left customer declarations');
select pg_temp.assert_withdrawal(not exists(select 1 from public.withdrawal_email_jobs where withdrawal_id in ('82000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000005')), 'Closed account left personal email payloads');
