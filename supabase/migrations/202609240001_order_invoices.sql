-- Fiscal data is captured before Checkout, then issued once after verified payment.
-- Existing checkouts/orders are deliberately not backfilled from mutable shop data.
alter table public.orders add column invoice_snapshot jsonb,
  add column invoice_paid_at timestamptz;

-- A stable, globally unique shop prefix prevents two shops owned by the same
-- legal seller from issuing indistinguishable invoice numbers.
create table public.order_invoice_prefixes (
  store_id uuid primary key references public.stores(id) on delete cascade,
  prefix bigint generated always as identity unique
);
revoke all on sequence public.order_invoice_prefixes_prefix_seq from public,anon,authenticated;
create table public.order_invoice_sequences (
  store_id uuid not null references public.stores(id) on delete cascade,
  stripe_mode text not null check (stripe_mode in ('test','live')),
  year integer not null,
  last_number bigint not null,
  primary key (store_id,stripe_mode,year)
);
create table public.order_documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  order_number text not null,
  stripe_mode text not null check (stripe_mode in ('test','live')),
  kind text not null check (kind in ('invoice','credit')),
  number text not null,
  original_number text,
  issued_at timestamptz not null default now(),
  paid_at timestamptz not null,
  snapshot jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','retry','ready','needs_review')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  pdf_sha256 text check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  last_error text,
  unique(order_id,kind),
  unique(store_id,stripe_mode,number),
  check ((kind='credit') = (original_number is not null)),
  check (status <> 'ready' or pdf_sha256 is not null)
);
create index order_documents_due on public.order_documents(stripe_mode,next_attempt_at)
  where status in ('pending','processing','retry');
create table public.order_document_cleanup (
  document_id uuid primary key,
  created_at timestamptz not null default now()
);
alter table public.order_invoice_prefixes enable row level security;
alter table public.order_invoice_sequences enable row level security;
alter table public.order_documents enable row level security;
alter table public.order_document_cleanup enable row level security;
revoke all on public.order_invoice_prefixes,public.order_invoice_sequences,public.order_documents,public.order_document_cleanup from public,anon,authenticated;
grant select on public.order_documents to service_role;
grant select,delete on public.order_document_cleanup to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('order-documents','order-documents',false,5242880,array['application/pdf']);
-- No storage policies for anon/authenticated: a server endpoint checks a receipt
-- credential or authenticated shop ownership before returning the PDF bytes.

create function public.guard_order_invoice_snapshot()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.invoice_snapshot is distinct from old.invoice_snapshot and
    (old.invoice_snapshot is not null or old.payment_status <> 'pending'
      or old.stripe_checkout_started_at is not null or old.stripe_checkout_session_id is not null) then
    raise exception 'INVOICE_SNAPSHOT_IMMUTABLE';
  end if;
  if old.invoice_paid_at is not null and new.invoice_paid_at is distinct from old.invoice_paid_at then
    raise exception 'INVOICE_PAYMENT_DATE_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger orders_guard_invoice_snapshot before update on public.orders
  for each row execute function public.guard_order_invoice_snapshot();

create function public.create_invoiced_stripe_order(
  target_store_id uuid, request_id text, order_number_value text, order_items jsonb,
  customer_name_value text, customer_email_value text, delivery_value text,
  product_subtotal_value numeric, total_value numeric, stripe_mode_value text,
  reservation_expires_at_value timestamptz, invoice_value jsonb
) returns public.orders language plpgsql security definer set search_path='' as $$
declare target public.orders%rowtype; line jsonb; gross bigint:=0; net bigint:=0; tax bigint:=0;
begin
  if invoice_value is null or invoice_value->>'version' is distinct from '1'
    or invoice_value->>'currency' is distinct from 'eur'
    or jsonb_typeof(invoice_value->'lines') is distinct from 'array'
    or jsonb_array_length(invoice_value->'lines') not between 1 and 51
    or lower(invoice_value#>>'{buyer,email}') is distinct from lower(customer_email_value)
    or nullif(btrim(invoice_value#>>'{buyer,name}'),'') is null
    or nullif(btrim(invoice_value#>>'{buyer,address}'),'') is null
    or nullif(btrim(invoice_value#>>'{seller,name}'),'') is null
    or nullif(btrim(invoice_value#>>'{seller,address}'),'') is null
    or coalesce(invoice_value#>>'{seller,registryCode}','') !~ '^[0-9]{8}$'
    or (invoice_value->>'vatRate')::numeric is not null and (invoice_value->>'vatRate')::numeric <> 24 then
    raise exception 'INVALID_INVOICE_SNAPSHOT';
  end if;
  for line in select value from jsonb_array_elements(invoice_value->'lines') loop
    if (line->>'quantity')::integer not between 1 and 99 or (line->>'unitGrossCents')::bigint <= 0
      or (line->>'grossCents')::bigint is distinct from (line->>'quantity')::integer*(line->>'unitGrossCents')::bigint
      or (line->>'netCents')::bigint < 0 or (line->>'vatCents')::bigint < 0
      or (line->>'grossCents')::bigint is distinct from (line->>'netCents')::bigint+(line->>'vatCents')::bigint then
      raise exception 'INVALID_INVOICE_LINES';
    end if;
    gross:=gross+(line->>'grossCents')::bigint;
    net:=net+(line->>'netCents')::bigint;
    tax:=tax+(line->>'vatCents')::bigint;
  end loop;
  if gross is distinct from round(total_value*100)::bigint
    or gross is distinct from (invoice_value->>'totalCents')::bigint
    or net is distinct from (invoice_value->>'netCents')::bigint
    or tax is distinct from (invoice_value->>'vatCents')::bigint
    or tax is distinct from (case when invoice_value->>'vatRate' is null then 0 else round(gross*24.0/124)::bigint end) then
    raise exception 'INVOICE_TOTAL_MISMATCH';
  end if;
  target:=public.create_stripe_order_with_reservation(target_store_id,request_id,order_number_value,order_items,
    customer_name_value,customer_email_value,delivery_value,product_subtotal_value,total_value,stripe_mode_value,reservation_expires_at_value);
  if target.invoice_snapshot is not null then
    if target.invoice_snapshot->'buyer' is distinct from invoice_value->'buyer' then raise exception 'CHECKOUT_REQUEST_REUSED'; end if;
    return target;
  end if;
  -- A pre-upgrade Checkout attempt must retain its original behavior.
  if target.stripe_checkout_started_at is not null or target.payment_status<>'pending' then return target; end if;
  update public.orders set invoice_snapshot=invoice_value,
    seller_vat_registered=invoice_value->>'vatRate' is not null,
    seller_vat_number=nullif(invoice_value#>>'{seller,vatNumber}',''),
    seller_vat_rate=(invoice_value->>'vatRate')::numeric,
    seller_vat_amount=tax/100.0
  where id=target.id returning * into target;
  return target;
end;
$$;

create function public.complete_invoiced_stripe_order(target_order_id uuid, checkout_session_id text, payment_intent_id text, paid_at_value timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.orders where id=target_order_id for update;
  if paid_at_value is null or paid_at_value>now()+interval '5 minutes' then raise exception 'INVALID_PAYMENT_DATE'; end if;
  update public.orders set invoice_paid_at=paid_at_value
  where id=target_order_id and invoice_snapshot is not null and invoice_paid_at is null and payment_status<>'refunded';
  perform public.complete_stripe_order(target_order_id,checkout_session_id,payment_intent_id);
end;
$$;

alter table public.order_email_jobs drop constraint order_email_jobs_kind_check;
alter table public.order_email_jobs add constraint order_email_jobs_kind_check
  check(kind in ('customer','seller','customer_credit','seller_credit'));

create function public.issue_order_document(target_order_id uuid, kind_value text)
returns public.order_documents language plpgsql security definer set search_path='' as $$
declare target public.orders%rowtype; document public.order_documents%rowtype; original public.order_documents%rowtype;
  year_value integer:=extract(year from now() at time zone 'Europe/Tallinn'); sequence_value bigint; prefix_value bigint; settings_value jsonb;
begin
  select * into target from public.orders where id=target_order_id for update;
  if not found or target.invoice_snapshot is null or target.payment_status not in ('paid','refunded')
    or target.stripe_payment_intent_id is null or target.stripe_mode is null then return null; end if;
  if kind_value not in ('invoice','credit') or kind_value='credit' and target.payment_status<>'refunded' then raise exception 'INVALID_DOCUMENT_KIND'; end if;
  select * into document from public.order_documents where order_id=target.id and kind=kind_value;
  if found then return document; end if;
  if kind_value='credit' then
    select * into original from public.order_documents where order_id=target.id and kind='invoice';
    if not found then raise exception 'ORIGINAL_INVOICE_MISSING'; end if;
  end if;
  insert into public.order_invoice_prefixes(store_id) values(target.store_id) on conflict(store_id) do nothing;
  select prefix into prefix_value from public.order_invoice_prefixes where store_id=target.store_id;
  insert into public.order_invoice_sequences(store_id,stripe_mode,year,last_number)
  values(target.store_id,target.stripe_mode,year_value,1)
  on conflict(store_id,stripe_mode,year) do update set last_number=public.order_invoice_sequences.last_number+1
  returning last_number into sequence_value;
  insert into public.order_documents(order_id,store_id,order_number,stripe_mode,kind,number,original_number,paid_at,snapshot)
  values(target.id,target.store_id,target.order_number,target.stripe_mode,kind_value,
    (case when target.stripe_mode='test' then 'TEST-' else '' end)||'PR'||prefix_value||'-'||year_value||'-'||lpad(sequence_value::text,greatest(6,length(sequence_value::text)),'0'),
    original.number,coalesce(target.invoice_paid_at,now()),coalesce(original.snapshot,target.invoice_snapshot)) returning * into document;
  perform public.get_or_create_order_receipt_token(target.id);
  update public.orders set retention_expires_at=greatest(retention_expires_at,((now() at time zone 'Europe/Tallinn')::date+interval '8 years')::date) where id=target.id;
  if kind_value='credit' then
    select settings into settings_value from public.stores where id=target.store_id;
    insert into public.order_email_jobs(order_id,kind,stripe_mode,status)
    values(target.id,'customer_credit',target.stripe_mode,'pending'),
      (target.id,'seller_credit',target.stripe_mode,case when settings_value->'sellerNotifications'='false'::jsonb then 'skipped' else 'pending' end)
    on conflict(order_id,kind) do nothing;
  end if;
  return document;
end;
$$;
create function public.issue_paid_order_documents()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.invoice_snapshot is not null and new.payment_status in ('paid','refunded') then
    perform public.issue_order_document(new.id,'invoice');
    if new.payment_status='refunded' then perform public.issue_order_document(new.id,'credit'); end if;
  end if;
  return new;
end;
$$;
create trigger orders_issue_documents after insert or update of payment_status on public.orders
  for each row execute function public.issue_paid_order_documents();

create function public.guard_order_document()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    insert into public.order_document_cleanup(document_id) values(old.id) on conflict do nothing;
    return old;
  end if;
  if (to_jsonb(new)-array['status','attempts','next_attempt_at','lease_token','lease_expires_at','pdf_sha256','last_error'])
    is distinct from (to_jsonb(old)-array['status','attempts','next_attempt_at','lease_token','lease_expires_at','pdf_sha256','last_error'])
    or old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256 then
    raise exception 'ISSUED_DOCUMENT_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger order_documents_guard before update or delete on public.order_documents
  for each row execute function public.guard_order_document();

create function public.claim_order_document(mode_value text,target_document_id uuid default null)
returns setof public.order_documents language plpgsql security definer set search_path='' as $$
begin
  return query with candidate as (
    select id from public.order_documents where stripe_mode=mode_value and status in ('pending','processing','retry')
      and (target_document_id is null or id=target_document_id) and next_attempt_at<=now()
      and (lease_expires_at is null or lease_expires_at<=now())
    order by next_attempt_at,issued_at limit 1 for update skip locked
  ) update public.order_documents doc set status='processing',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes'
    from candidate where doc.id=candidate.id returning doc.*;
end;
$$;
create function public.finish_order_document(target_document_id uuid,token_value uuid,outcome_value text,sha256_value text default null,error_value text default null)
returns public.order_documents language plpgsql security definer set search_path='' as $$
declare document public.order_documents%rowtype;
begin
  if outcome_value not in ('ready','retry','needs_review') or outcome_value='ready' and coalesce(sha256_value,'') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_DOCUMENT_OUTCOME'; end if;
  update public.order_documents set status=outcome_value,pdf_sha256=coalesce(sha256_value,pdf_sha256),
    lease_token=null,lease_expires_at=null,last_error=left(error_value,500),
    next_attempt_at=now()+make_interval(secs=>least(3600,15*power(2,least(attempts,8)))::integer)
  where id=target_document_id and token_value is not null and lease_token=token_value and lease_expires_at>now()
  returning * into document;
  if not found then raise exception 'DOCUMENT_LEASE_LOST'; end if;
  return document;
end;
$$;
create or replace function public.enqueue_paid_order_emails()
returns trigger language plpgsql security definer set search_path = '' as $$
declare settings_value jsonb;
begin
  if new.payment_status <> 'paid' or new.stripe_mode is null or new.stripe_payment_intent_id is null then return new; end if;
  select settings into settings_value from public.stores where id = new.store_id;
  insert into public.order_email_jobs(order_id, kind, stripe_mode, status, accepted_at)
  select new.id, email.kind, new.stripe_mode,
    case when email.sent_at is not null then 'accepted'
      when settings_value -> email.setting_key = 'false'::jsonb and not (email.kind='customer' and new.invoice_snapshot is not null) then 'skipped' else 'pending' end,
    email.sent_at
  from (values ('customer', 'customerConfirmations', new.customer_confirmation_sent_at),
    ('seller', 'sellerNotifications', new.seller_notification_sent_at)) email(kind, setting_key, sent_at)
  on conflict (order_id, kind) do nothing;
  return new;
end;
$$;

create or replace function public.claim_order_email_job(mode_value text, target_order_id uuid default null, kind_value text default null)
returns setof public.order_email_jobs language plpgsql security definer set search_path = '' as $$
declare job_id uuid;
begin
  if mode_value is null or mode_value not in ('test','live') then raise exception 'INVALID_STRIPE_MODE'; end if;
  if kind_value is not null and kind_value not in ('customer','seller','customer_credit','seller_credit') then raise exception 'INVALID_EMAIL_KIND'; end if;
  select job.id into job_id from public.order_email_jobs job
  where job.stripe_mode = mode_value and job.status in ('pending','processing','retry')
    and (target_order_id is null or job.order_id = target_order_id)
    and (kind_value is null or job.kind = kind_value)
    and job.next_attempt_at <= now()
    and (job.lease_expires_at is null or job.lease_expires_at <= now())
  order by job.next_attempt_at, job.created_at, job.kind
  for update skip locked limit 1;
  if job_id is null then return; end if;
  return query update public.order_email_jobs set status = 'processing', attempts = attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + interval '2 minutes'
    where id = job_id returning *;
end;
$$;

create or replace function public.prepare_order_email_send(target_job_id uuid, token_value uuid, payload_value jsonb default null)
returns public.order_email_jobs language plpgsql security definer set search_path = '' as $$
declare job public.order_email_jobs%rowtype; payment public.orders%rowtype; settings_value jsonb; enabled boolean; legacy_sent_at timestamptz;
begin
  select * into job from public.order_email_jobs where id = target_job_id for update;
  if not found or token_value is null or job.lease_token is distinct from token_value
    or job.lease_expires_at is null or job.lease_expires_at <= now() then raise exception 'EMAIL_LEASE_LOST'; end if;
  if job.resend_email_id is not null then return job; end if;
  select * into payment from public.orders where id = job.order_id;
  legacy_sent_at := case job.kind when 'customer' then payment.customer_confirmation_sent_at when 'seller' then payment.seller_notification_sent_at else null end;
  if legacy_sent_at is not null then
    update public.order_email_jobs set status = 'accepted', accepted_at = legacy_sent_at, legacy_import = true
      where id = job.id returning * into job;
    return job;
  end if;
  select settings into settings_value from public.stores where id = payment.store_id;
  enabled := settings_value -> (case when job.kind like 'customer%' then 'customerConfirmations' else 'sellerNotifications' end)
    is distinct from 'false'::jsonb;
  if payment.invoice_snapshot is not null and job.kind like 'customer%' then enabled:=true; end if;
  if (case when job.kind in ('customer_credit','seller_credit') then payment.payment_status<>'refunded'
    when payment.invoice_snapshot is not null then payment.payment_status not in ('paid','refunded')
    else payment.payment_status<>'paid' end) or not enabled then
    update public.order_email_jobs set
      status = case when payload is null then 'skipped' else 'needs_review' end,
      last_error = case when payload is null then 'Kiri ei ole enam vajalik.' else 'Varasema saatmiskatse tulemus vajab kontrolli.' end
      where id = job.id returning * into job;
    return job;
  end if;
  if job.payload is null then
    if payload_value is null then return job; end if; -- Eligibility/lease check before rendering.
    if jsonb_typeof(payload_value) is distinct from 'object'
      or jsonb_typeof(payload_value -> 'to') is distinct from 'array'
      or jsonb_array_length(payload_value -> 'to') <> 1
      or coalesce(payload_value #>> '{to,0}', '') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or nullif(payload_value ->> 'from', '') is null
      or nullif(payload_value ->> 'subject', '') is null
      or nullif(payload_value ->> 'html', '') is null
      or not coalesce(payload_value -> 'tags' @> jsonb_build_array(
        jsonb_build_object('name','order_id','value',job.order_id::text),
        jsonb_build_object('name','order_email_job_id','value',job.id::text),
        jsonb_build_object('name','email_type','value',case job.kind when 'customer' then 'order_customer_confirmation' when 'seller' then 'order_seller_notification' else 'order_'||job.kind end)), false)
    then raise exception 'INVALID_EMAIL_PAYLOAD'; end if;
    if job.kind like 'customer%' and lower(payload_value #>> '{to,0}') <> lower(coalesce(payment.invoice_snapshot#>>'{buyer,email}',payment.customer_email)) then
      raise exception 'EMAIL_RECIPIENT_MISMATCH';
    end if;
    update public.order_email_jobs set payload = payload_value, first_attempt_at = now()
      where id = job.id returning * into job;
  end if;
  return job;
end;
$$;

create or replace function public.finish_order_email_job(target_job_id uuid, token_value uuid, outcome_value text,
  email_id_value text default null, error_value text default null)
returns public.order_email_jobs language plpgsql security definer set search_path = '' as $$
declare job public.order_email_jobs%rowtype; oid uuid;
begin
  -- Same lock order as payment confirmation and delivery callbacks.
  select order_id into oid from public.order_email_jobs where id = target_job_id;
  perform 1 from public.orders where id = oid for update;
  select * into job from public.order_email_jobs where id = target_job_id for update;
  if not found or token_value is null or job.lease_token is distinct from token_value
    or job.lease_expires_at is null or job.lease_expires_at <= now() then raise exception 'EMAIL_LEASE_LOST'; end if;
  if outcome_value is null or outcome_value not in ('accepted','retry','skipped','needs_review') then raise exception 'INVALID_EMAIL_OUTCOME'; end if;
  if email_id_value is not null and job.resend_email_id is not null and email_id_value <> job.resend_email_id then
    raise exception 'EMAIL_PROVIDER_ID_MISMATCH';
  end if;
  -- A webhook may have confirmed delivery while the HTTP send was timing out.
  if job.resend_email_id is not null then outcome_value := 'accepted'; end if;
  if outcome_value = 'accepted' and not (job.legacy_import and job.accepted_at is not null and job.resend_email_id is null) then
    email_id_value := coalesce(job.resend_email_id, nullif(btrim(email_id_value), ''));
    if email_id_value is null or job.payload is null then raise exception 'EMAIL_ACCEPTANCE_REFERENCE_REQUIRED'; end if;
    update public.order_email_jobs set resend_email_id = email_id_value, accepted_at = coalesce(accepted_at, now()),
      delivery_status = coalesce(delivery_status, 'sent') where id = job.id returning * into job;
    update public.orders set
      customer_confirmation_sent_at = case when job.kind = 'customer' then coalesce(customer_confirmation_sent_at, job.accepted_at) else customer_confirmation_sent_at end,
      seller_notification_sent_at = case when job.kind = 'seller' then coalesce(seller_notification_sent_at, job.accepted_at) else seller_notification_sent_at end
      where id = job.order_id;
    insert into public.email_deliveries(resend_email_id, recipient_email, subject, email_type, status, sent_at, status_updated_at)
    values (email_id_value, lower(job.payload #>> '{to,0}'), job.payload ->> 'subject',
      case job.kind when 'customer' then 'order_customer_confirmation' when 'seller' then 'order_seller_notification' else 'order_'||job.kind end,
      job.delivery_status, job.accepted_at, coalesce(job.delivery_event_at, job.accepted_at))
    on conflict (resend_email_id) do nothing;
  end if;
  update public.order_email_jobs set status = outcome_value, lease_token = null, lease_expires_at = null,
    last_error = case when outcome_value = 'accepted' then null else coalesce(left(error_value, 500), last_error) end,
    next_attempt_at = now() + make_interval(secs => least(3600, 15 * power(2, least(attempts,8))::integer))
    where id = job.id returning * into job;
  return job;
end;
$$;

create or replace function public.record_order_email_delivery(target_job_id uuid, order_id_value uuid, kind_value text,
  event_id_value text, email_id_value text, recipient_value text, status_value text, occurred_at_value timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.order_email_jobs%rowtype; inserted integer; apply_status boolean;
begin
  if status_value is null or status_value not in ('sent','delivery_delayed','delivered','failed','bounced','complained','suppressed')
    or nullif(btrim(event_id_value),'') is null or nullif(btrim(email_id_value),'') is null or occurred_at_value is null then
    raise exception 'INVALID_EMAIL_EVENT';
  end if;
  perform 1 from public.orders where id = order_id_value for update;
  select * into job from public.order_email_jobs where id = target_job_id and order_id = order_id_value and kind = kind_value for update;
  if not found or job.payload is null then return false; end if;
  if lower(recipient_value) is distinct from lower(job.payload #>> '{to,0}')
    or (job.resend_email_id is not null and job.resend_email_id <> email_id_value) then
    raise exception 'EMAIL_EVENT_MISMATCH';
  end if;
  -- Receipt and business outcome share one transaction, including early webhooks.
  insert into public.resend_webhook_events(id, event_type) values (event_id_value, 'email.' || status_value)
    on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return true; end if;
  apply_status := (job.delivery_event_at is null or occurred_at_value >= job.delivery_event_at)
    and (job.delivery_status is null or job.delivery_status in ('sent','delivery_delayed')
      or status_value in ('delivered','failed','bounced','complained','suppressed'))
    and (job.delivery_status is distinct from 'complained' or status_value = 'complained');
  update public.order_email_jobs set status = 'accepted', resend_email_id = email_id_value,
    accepted_at = coalesce(accepted_at, occurred_at_value), last_error = null,
    delivery_status = case when apply_status then status_value else delivery_status end,
    delivery_event_at = case when apply_status then occurred_at_value else delivery_event_at end,
    delivered_at = case when status_value = 'delivered' then coalesce(delivered_at, occurred_at_value) else delivered_at end
    where id = job.id returning * into job;
  update public.orders set
    customer_confirmation_sent_at = case when job.kind = 'customer' then coalesce(customer_confirmation_sent_at, job.accepted_at) else customer_confirmation_sent_at end,
    seller_notification_sent_at = case when job.kind = 'seller' then coalesce(seller_notification_sent_at, job.accepted_at) else seller_notification_sent_at end
    where id = job.order_id;
  insert into public.email_deliveries(resend_email_id, recipient_email, subject, email_type, status, sent_at, status_updated_at)
  values (email_id_value, lower(job.payload #>> '{to,0}'), job.payload ->> 'subject',
    case job.kind when 'customer' then 'order_customer_confirmation' when 'seller' then 'order_seller_notification' else 'order_'||job.kind end,
    job.delivery_status, job.accepted_at, job.delivery_event_at)
  on conflict (resend_email_id) do update set status = excluded.status, status_updated_at = excluded.status_updated_at;
  return true;
end;
$$;

-- Only service code may create/issue documents or operate their leases.
do $$ declare fn regprocedure;
begin
  foreach fn in array array[
    'public.guard_order_invoice_snapshot()'::regprocedure,
    'public.create_invoiced_stripe_order(uuid,text,text,jsonb,text,text,text,numeric,numeric,text,timestamptz,jsonb)'::regprocedure,
    'public.complete_invoiced_stripe_order(uuid,text,text,timestamptz)'::regprocedure,
    'public.issue_order_document(uuid,text)'::regprocedure,'public.issue_paid_order_documents()'::regprocedure,
    'public.guard_order_document()'::regprocedure,'public.claim_order_document(text,uuid)'::regprocedure,
    'public.finish_order_document(uuid,uuid,text,text,text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',fn);
    execute format('grant execute on function %s to service_role',fn);
  end loop;
end;
$$;
