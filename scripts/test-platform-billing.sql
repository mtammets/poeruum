create function pg_temp.billing_assert(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception '%',message; end if; end; $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('7a000000-0000-4000-8000-000000000001','authenticated','authenticated','platform-invoice@example.invalid','{}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug,settings)
values('7a000000-0000-4000-8000-000000000002','7a000000-0000-4000-8000-000000000001','Tasuarve test','platform-invoice-test','{}');

create function pg_temp.fee_order(type_value text default 'company',mode_value text default 'test',paid_at_value timestamptz default '2026-10-01 01:00:00+00',net_value integer default 400)
returns uuid language plpgsql as $$
declare id_value uuid:=gen_random_uuid(); vat_value integer:=round(net_value*0.24); captured jsonb;
begin
  captured:=jsonb_build_object('version',1,'currency','eur','storeName','Tasuarve test','storeSlug','test','storeAccent','#e5f25a','storeLogo','',
    'sellerEmail','seller@example.invalid','delivery','Tulen ise järele','vatRate',null,'netCents',10000,'vatCents',0,'totalCents',10000,
    'seller',jsonb_build_object('type',type_value,'name','Algne müüja','registryCode',case when type_value='entrepreneur' then 'PRIVATE_ID' else '12345678' end,
      'vatNumber',case when type_value='entrepreneur' then 'PRIVATE_VAT' else 'EE123456789' end,'email','seller@example.invalid','address','Kase 1, Tartu'),
    'buyer',jsonb_build_object('name','Kauba ostja','email','customer@example.invalid','address','Tallinn','company',false,'registryCode','','vatNumber',''),
    'lines',jsonb_build_array(jsonb_build_object('kind','product','name','Maal','quantity',1,'unitGrossCents',10000,'grossCents',10000,'netCents',10000,'vatCents',0,'options','')));
  insert into public.orders(id,store_id,order_number,items,customer_name,customer_email,delivery,product_subtotal,total,payment_status,
    stripe_mode,stripe_payment_intent_id,stripe_transfer_id,stripe_platform_fee_net_cents,stripe_platform_fee_vat_cents,stripe_platform_fee_cents,
    invoice_snapshot,invoice_paid_at)
  values(id_value,'7a000000-0000-4000-8000-000000000002','FEE-'||left(id_value::text,8),'[]','Kauba ostja','customer@example.invalid','Tulen ise järele',100,100,'paid',
    mode_value,'pi_'||id_value,'tr_'||id_value,net_value,vat_value,net_value+vat_value,captured,paid_at_value);
  return id_value;
end; $$;
create function pg_temp.fee_revenue(id_value uuid,credit_value boolean default false)
returns void language plpgsql as $$
begin
  insert into public.revenue_events(provider,provider_event_id,provider_object_id,store_id,kind,amount_cents,currency,description,occurred_at,metadata)
  select 'stripe',(case when credit_value then 'refund:' else 'fee:' end)||id_value,
    (case when credit_value then 're_' else 'tr_' end)||id_value,store_id,
    case when credit_value then 'transaction_fee_refund' else 'transaction_fee' end,
    stripe_platform_fee_net_cents*(case when credit_value then -1 else 1 end),'eur','Test',now(),jsonb_build_object('order_id',id_value)
  from public.orders where id=id_value and stripe_platform_fee_net_cents>0;
end; $$;

do $$ declare id_value uuid; second_id uuid; original public.platform_fee_documents%rowtype;
  credit public.platform_fee_documents%rowtype; job public.platform_fee_documents%rowtype; failed boolean;
begin
  perform pg_temp.billing_assert(public.platform_vat_percent('2026-09-30 20:59:59.999+00')=0,'Registration began too early');
  perform pg_temp.billing_assert(public.platform_vat_percent('2026-09-30 21:00:00+00')=24,'Estonian registration midnight not respected');
  perform pg_temp.billing_assert(not has_table_privilege('anon','public.platform_fee_documents','select')
    and not has_table_privilege('authenticated','public.platform_fee_documents','select'),'Platform invoice data exposed');
  perform pg_temp.billing_assert(not has_function_privilege('authenticated','public.issue_platform_fee_document(uuid,text)','execute')
    and not has_function_privilege('anon','public.claim_platform_fee_document(text,uuid)','execute'),'Fiscal write RPC exposed');

  id_value:=pg_temp.fee_order('entrepreneur');
  perform pg_temp.billing_assert(not exists(select 1 from public.platform_fee_documents where order_id=id_value),'Fee invoiced before collection');
  update public.stores set settings='{"businessName":"CHANGED IDENTITY","businessAddress":"CHANGED ADDRESS"}' where id='7a000000-0000-4000-8000-000000000002';
  perform pg_temp.fee_revenue(id_value);
  select * into original from public.platform_fee_documents where order_id=id_value and kind='invoice';
  perform pg_temp.billing_assert(original.id is not null and original.number='TEST-PF-'||extract(year from now() at time zone 'Europe/Tallinn')||'-000001','Platform numbering incorrect');
  perform pg_temp.billing_assert(original.snapshot#>>'{seller,vatNumber}'='EE103036036','Platform VAT identity missing');
  perform pg_temp.billing_assert(original.snapshot#>>'{buyer,name}'='Algne müüja' and original.snapshot#>>'{buyer,address}'='Kase 1, Tartu','Mutable buyer identity used');
  perform pg_temp.billing_assert(original.snapshot#>>'{buyer,registryCode}'='' and original.snapshot#>>'{buyer,vatNumber}'='','Private entrepreneur identity exposed');
  perform pg_temp.billing_assert(original.snapshot->>'netCents'='400' and original.snapshot->>'vatCents'='96' and original.snapshot->>'totalCents'='496','Fee amounts incorrect');
  perform public.issue_platform_fee_document(id_value,'invoice');
  perform pg_temp.billing_assert((select count(*)=1 from public.platform_fee_documents where order_id=id_value),'Duplicate fee invoice');
  perform pg_temp.billing_assert((select count(*)=1 from public.order_documents where order_id=id_value),'Fee invoice leaked into customer documents');
  failed:=false;
  begin update public.platform_fee_documents set snapshot='{}' where id=original.id; exception when others then failed:=sqlerrm='ISSUED_DOCUMENT_IMMUTABLE'; end;
  perform pg_temp.billing_assert(failed,'Issued invoice was mutable');

  select * into job from public.claim_platform_fee_document('test',original.id);
  perform pg_temp.billing_assert(job.lease_token is not null,'PDF generation did not claim the invoice');
  perform pg_temp.billing_assert(not exists(select 1 from public.claim_platform_fee_document('test',original.id)),'Concurrent PDF workers both claimed invoice');
  failed:=false;
  begin perform public.finish_platform_fee_document(original.id,gen_random_uuid(),'ready',repeat('a',64)); exception when others then failed:=sqlerrm='DOCUMENT_LEASE_LOST'; end;
  perform pg_temp.billing_assert(failed,'Wrong worker could complete PDF');
  perform public.finish_platform_fee_document(original.id,job.lease_token,'ready',repeat('a',64));

  update public.orders set payment_status='refunded',status='refunded' where id=id_value;
  perform pg_temp.billing_assert(not exists(select 1 from public.platform_fee_documents where order_id=id_value and kind='credit'),'Customer refund credited fee before settlement');
  perform pg_temp.fee_revenue(id_value,true);
  select * into credit from public.platform_fee_documents where order_id=id_value and kind='credit';
  perform pg_temp.billing_assert(credit.original_number=original.number and credit.snapshot=original.snapshot,'Credit lost original tax or identity');
  perform public.issue_platform_fee_document(id_value,'credit');
  perform pg_temp.billing_assert((select count(*)=2 from public.platform_fee_documents where order_id=id_value),'Duplicate credit note');

  second_id:=pg_temp.fee_order('company','live'); perform pg_temp.fee_revenue(second_id);
  perform pg_temp.billing_assert((select number='PF-'||extract(year from now() at time zone 'Europe/Tallinn')||'-000001' from public.platform_fee_documents where order_id=second_id),'Test/live numbering not separated');
  perform pg_temp.billing_assert(not exists(select 1 from public.claim_platform_fee_document('test',(select id from public.platform_fee_documents where order_id=second_id))),'PDF worker crossed Stripe modes');

  second_id:=pg_temp.fee_order('company','test','2026-09-30 20:59:59+00'); perform pg_temp.fee_revenue(second_id);
  perform pg_temp.billing_assert(not exists(select 1 from public.platform_fee_documents where order_id=second_id),'Pre-registration VAT was retrospectively invoiced');
  second_id:=pg_temp.fee_order('company','test','2026-10-01 01:00:00+00',0); perform pg_temp.fee_revenue(second_id);
  perform pg_temp.billing_assert(not exists(select 1 from public.platform_fee_documents where order_id=second_id),'Zero fee was invoiced');
  second_id:=pg_temp.fee_order('company','test','2026-10-01 01:00:00+00',1); perform pg_temp.fee_revenue(second_id);
  perform pg_temp.billing_assert((select snapshot->>'vatRate'='24' and snapshot->>'vatCents'='0' and snapshot->>'totalCents'='1' from public.platform_fee_documents where order_id=second_id),'Rounded-zero VAT lost the tax rate');
  perform pg_temp.billing_assert((select retention_expires_at >= (now()::date+interval '8 years')::date from public.orders where id=id_value),'Fiscal retention was not extended');
  update public.platform_invoice_sequences set last_number=999999 where stripe_mode='test' and year=extract(year from now() at time zone 'Europe/Tallinn');
  second_id:=pg_temp.fee_order(); perform pg_temp.fee_revenue(second_id);
  perform pg_temp.billing_assert((select number like '%-1000000' from public.platform_fee_documents where order_id=second_id),'Long invoice sequence was truncated');
end; $$;

do $$ declare before_value record; after_value record; failed boolean:=false;
begin
  perform set_config('request.jwt.claims','{"app_metadata":{}}',true);
  begin perform public.admin_revenue_dashboard(); exception when insufficient_privilege then failed:=true; end;
  perform pg_temp.billing_assert(failed,'Ordinary user accessed platform revenue');
  perform set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
  select * into before_value from public.admin_revenue_dashboard();
  insert into public.revenue_events(provider,provider_event_id,kind,amount_cents,currency,description,occurred_at,metadata) values
    ('stripe','billing-test-live','subscription',2900,'eur','Test',now(),'{"livemode":true,"vat_amount_cents":696}'),
    ('stripe','billing-test-credit','subscription',-2900,'eur','Test',now(),'{"livemode":true,"billing_adjustment":"credit_note","vat_amount_cents":-696}'),
    ('stripe','billing-test-ignored','subscription',999999,'eur','Test',now(),'{"livemode":false}');
  select * into after_value from public.admin_revenue_dashboard();
  perform pg_temp.billing_assert(after_value.month_total_cents=before_value.month_total_cents,'Refunded or test subscription inflated live revenue');
  perform pg_temp.billing_assert(after_value.subscription_total_cents=before_value.subscription_total_cents+2900
    and after_value.refund_total_cents=before_value.refund_total_cents-2900,'Subscription credit was not displayed as a refund');
  perform set_config('request.jwt.claims','{}',true);
end; $$;
