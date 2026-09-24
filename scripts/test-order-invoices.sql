\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end;
$$;
create function pg_temp.expect_error(statement text,message text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if position(message in sqlerrm)>0 then return; end if; raise;
  end;
  raise exception 'Expected error: %',message;
end;
$$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('79000000-0000-4000-8000-000000000001','authenticated','authenticated','invoice-test@example.invalid','{}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug,settings)
values('79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000001','Arvepood','invoice-test',
'{"customerConfirmations":false,"sellerNotifications":false}');
insert into public.products(id,store_id,name,image_url,price,stock)
values('invoice-product','79000000-0000-4000-8000-000000000002','Õun','',12.40,20);
create function pg_temp.snapshot() returns jsonb language sql as $$
select '{"version":1,"currency":"eur","storeName":"Arvepood","storeSlug":"invoice-test","sellerEmail":"seller@example.invalid",
"seller":{"name":"Müüja OÜ","registryCode":"12345678","address":"Kase 1, Tallinn","email":"seller@example.invalid","vatNumber":"EE123456789"},
"buyer":{"name":"Ostja OÜ","company":true,"registryCode":"87654321","vatNumber":"","address":"Pärna 1, Tartu","email":"buyer@example.invalid"},
"delivery":"Tulen ise järele","lines":[{"name":"Õun","options":"","quantity":1,"unitGrossCents":1240,"grossCents":1240,"netCents":1000,"vatCents":240}],
"vatRate":24,"netCents":1000,"vatCents":240,"totalCents":1240}'::jsonb;
$$;
create function pg_temp.checkout(request_value text,snapshot_value jsonb default pg_temp.snapshot()) returns public.orders language sql as $$
select public.create_invoiced_stripe_order('79000000-0000-4000-8000-000000000002',request_value,request_value,
'[{"id":"invoice-product","name":"Õun","price":12.40,"quantity":1}]','Ostja','buyer@example.invalid','Tulen ise järele',12.4,12.4,'test',now()+interval '35 minutes',snapshot_value);
$$;
do $$ declare target public.orders%rowtype; retry public.orders%rowtype; invoice public.order_documents%rowtype;
  credit public.order_documents%rowtype; job public.order_email_jobs%rowtype; payload jsonb; old_token uuid; fn regprocedure;
begin
  foreach fn in array array[
    'public.create_invoiced_stripe_order(uuid,text,text,jsonb,text,text,text,numeric,numeric,text,timestamptz,jsonb)'::regprocedure,
    'public.issue_order_document(uuid,text)'::regprocedure,'public.claim_order_document(text,uuid)'::regprocedure,
    'public.finish_order_document(uuid,uuid,text,text,text)'::regprocedure
  ] loop
    perform pg_temp.assert_true(not has_function_privilege('anon',fn,'execute') and not has_function_privilege('authenticated',fn,'execute'),'Fiscal RPC exposed');
  end loop;
  perform pg_temp.assert_true(not has_table_privilege('authenticated','public.order_documents','select') and not has_table_privilege('anon','public.order_documents','select'),'Invoice data exposed');
  perform pg_temp.assert_true(not has_column_privilege('authenticated','public.orders','invoice_snapshot','update'),'Merchant can edit the fiscal snapshot');
  perform pg_temp.assert_true((select not public from storage.buckets where id='order-documents'),'Invoice bucket is public');
  perform pg_temp.expect_error($q$select pg_temp.checkout('invoice-request-invalid',jsonb_set(pg_temp.snapshot(),'{totalCents}','1239'))$q$,'INVOICE_TOTAL_MISMATCH');
  target:=pg_temp.checkout('invoice-request-first');
  perform pg_temp.assert_true(not exists(select 1 from public.order_documents where order_id=target.id),'Unpaid order received invoice');
  retry:=pg_temp.checkout('invoice-request-first',jsonb_set(pg_temp.snapshot(),'{seller,name}','"Changed shop"'));
  perform pg_temp.assert_true(retry.id=target.id and retry.invoice_snapshot=target.invoice_snapshot,'Retry changed seller snapshot');
  perform pg_temp.expect_error($q$select pg_temp.checkout('invoice-request-first',jsonb_set(pg_temp.snapshot(),'{buyer,address}','"Changed buyer"'))$q$,'CHECKOUT_REQUEST_REUSED');
  perform pg_temp.expect_error(format('update public.orders set invoice_snapshot=''{}'' where id=%L',target.id),'INVOICE_SNAPSHOT_IMMUTABLE');
  begin
    perform public.complete_invoiced_stripe_order(target.id,'cs_invoice_1','pi_invoice_1',now());
    raise exception 'ROLLBACK_INVOICE';
  exception when others then if sqlerrm<>'ROLLBACK_INVOICE' then raise; end if; end;
  perform pg_temp.assert_true(not exists(select 1 from public.order_documents where order_id=target.id),'Rolled-back payment issued an invoice');
  perform public.complete_invoiced_stripe_order(target.id,'cs_invoice_1','pi_invoice_1',now()-interval '1 hour');
  perform public.complete_invoiced_stripe_order(target.id,'cs_invoice_1','pi_invoice_1',now());
  select * into invoice from public.order_documents where order_id=target.id;
  perform pg_temp.assert_true(invoice.number like 'TEST-%-000001' and invoice.kind='invoice','Unexpected first invoice number');
  perform pg_temp.assert_true(invoice.paid_at=now()-interval '1 hour','Retry changed the payment date');
  perform pg_temp.assert_true((select count(*)=1 from public.order_documents where order_id=target.id),'Duplicate invoice');
  perform pg_temp.assert_true((select stock=19 from public.products where id='invoice-product'),'Duplicate stock reduction');
  perform pg_temp.assert_true((select status='pending' from public.order_email_jobs where order_id=target.id and kind='customer'),'Notification preference disabled the buyer invoice');
  perform pg_temp.assert_true((select status='skipped' from public.order_email_jobs where order_id=target.id and kind='seller'),'Seller preference ignored');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_order_document('live',invoice.id)),'Worker crossed modes');
  select * into invoice from public.claim_order_document('test',invoice.id);
  old_token:=invoice.lease_token;
  perform pg_temp.assert_true(not exists(select 1 from public.claim_order_document('test',invoice.id)),'Document leased twice');
  update public.order_documents set lease_expires_at=now()-interval '1 second' where id=invoice.id;
  select * into invoice from public.claim_order_document('test',invoice.id);
  perform pg_temp.expect_error(format('select public.finish_order_document(%L,%L,''ready'',%L)',invoice.id,old_token,repeat('a',64)),'DOCUMENT_LEASE_LOST');
  invoice:=public.finish_order_document(invoice.id,invoice.lease_token,'ready',repeat('a',64));
  perform pg_temp.expect_error(format('update public.order_documents set snapshot=''{}'' where id=%L',invoice.id),'ISSUED_DOCUMENT_IMMUTABLE');
  perform pg_temp.expect_error(format('update public.order_documents set pdf_sha256=%L where id=%L',repeat('b',64),invoice.id),'ISSUED_DOCUMENT_IMMUTABLE');
  update public.orders set payment_status='refunded',status='refunded',stripe_refund_status='succeeded' where id=target.id;
  update public.orders set payment_status='refunded' where id=target.id;
  select * into credit from public.order_documents where order_id=target.id and kind='credit';
  perform pg_temp.assert_true(credit.original_number=invoice.number and credit.snapshot=invoice.snapshot,'Credit lost original fiscal data');
  perform pg_temp.assert_true(credit.number like 'TEST-%-000002','Credit numbering is not unique');
  perform pg_temp.assert_true((select count(*)=2 from public.order_documents where order_id=target.id),'Duplicate credit');
  select * into job from public.claim_order_email_job('test',target.id,'customer_credit');
  perform pg_temp.assert_true(job.id is not null,'Refund did not enqueue a credit email');
  payload:=jsonb_build_object('from','Pood <seller@example.invalid>','to',jsonb_build_array('buyer@example.invalid'),
    'subject','Kreeditarve','html','<p>Kreeditarve</p>','text','Kreeditarve','tags',jsonb_build_array(
      jsonb_build_object('name','email_type','value','order_customer_credit'),
      jsonb_build_object('name','order_id','value',target.id::text),jsonb_build_object('name','order_email_job_id','value',job.id::text)));
  job:=public.prepare_order_email_send(job.id,job.lease_token,payload);
  perform public.record_order_email_delivery(job.id,target.id,'customer_credit','evt_invoice_credit','email_invoice_credit','buyer@example.invalid','delivered',now());
  job:=public.finish_order_email_job(job.id,job.lease_token,'retry',null,'Response lost');
  perform pg_temp.assert_true(job.status='accepted' and job.delivery_status='delivered','Credit replay lost delivery confirmation');
  perform pg_temp.assert_true((select customer_confirmation_sent_at is null from public.orders where id=target.id),'Credit overwrote the original confirmation timestamp');
  retry:=pg_temp.checkout('invoice-request-second');
  perform public.complete_invoiced_stripe_order(retry.id,'cs_invoice_2','pi_invoice_2',now());
  perform pg_temp.assert_true((select number like 'TEST-%-000003' from public.order_documents where order_id=retry.id),'Per-store sequence did not advance');
  -- Existing orders without a snapshot keep their historical email behavior.
  insert into public.orders(store_id,order_number,items,customer_name,customer_email,delivery,product_subtotal,total,payment_status,stripe_mode,stripe_payment_intent_id)
  values(target.store_id,'PR-LEGACY','[]','Legacy','legacy@example.invalid','Pickup',1,1,'paid','test','pi_invoice_legacy');
  perform pg_temp.assert_true(not exists(select 1 from public.order_documents where order_number='PR-LEGACY'),'Invented historical invoice');
  delete from auth.users where id='79000000-0000-4000-8000-000000000001';
  perform pg_temp.assert_true((select snapshot=invoice.snapshot from public.order_documents where id=invoice.id),'Account deletion changed the issued invoice');
  delete from public.orders where id=target.id;
  perform pg_temp.assert_true((select count(*)=2 from public.order_document_cleanup where document_id in (invoice.id,credit.id)),'Expired PDFs were orphaned');
end;
$$;
rollback;
