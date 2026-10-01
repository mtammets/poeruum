-- Animaator OÜ registration begins at midnight in Estonia, not midnight UTC.
create function public.platform_vat_percent(at_value timestamptz)
returns integer language sql immutable strict set search_path='' as $$
  select case when at_value >= timestamptz '2026-10-01 00:00:00 Europe/Tallinn' then 24 else 0 end;
$$;
revoke all on function public.platform_vat_percent(timestamptz) from public,anon,authenticated;
grant execute on function public.platform_vat_percent(timestamptz) to service_role;

-- Platform invoices must never be included in the buyer's order-document API.
create table public.platform_fee_documents (like public.order_documents including all);
alter table public.platform_fee_documents
  add foreign key(order_id) references public.orders(id) on delete cascade,
  add foreign key(store_id) references public.stores(id),
  add unique(stripe_mode,number);
create table public.platform_invoice_sequences (
  stripe_mode text not null check(stripe_mode in ('test','live')),
  year integer not null, last_number bigint not null,
  primary key(stripe_mode,year)
);
alter table public.platform_fee_documents enable row level security;
alter table public.platform_invoice_sequences enable row level security;
revoke all on public.platform_fee_documents,public.platform_invoice_sequences from public,anon,authenticated;
grant select on public.platform_fee_documents to service_role;

create trigger platform_fee_documents_guard before update or delete on public.platform_fee_documents
  for each row execute function public.guard_order_document();

create function public.issue_platform_fee_document(target_order_id uuid,kind_value text)
returns public.platform_fee_documents language plpgsql security definer set search_path='' as $$
declare payment public.orders%rowtype; original public.platform_fee_documents%rowtype;
  document public.platform_fee_documents%rowtype; captured jsonb; merchant jsonb;
  year_value integer:=extract(year from now() at time zone 'Europe/Tallinn'); sequence_value bigint;
begin
  select * into payment from public.orders where id=target_order_id for update;
  if not found or payment.stripe_transfer_id is null or payment.stripe_platform_fee_cents<=0
    or payment.invoice_paid_at is null or public.platform_vat_percent(payment.invoice_paid_at)=0
    or payment.payment_status not in ('paid','refunded') then return null; end if;
  if kind_value is null or kind_value not in ('invoice','credit') then raise exception 'INVALID_DOCUMENT_KIND'; end if;
  if kind_value='credit' and payment.payment_status<>'refunded' then raise exception 'PLATFORM_REFUND_NOT_CONFIRMED'; end if;
  select * into document from public.platform_fee_documents where order_id=payment.id and kind=kind_value;
  if found then return document; end if;
  -- Only a recorded settlement/refund proves that the fee was collected/returned.
  if not exists(select 1 from public.revenue_events where store_id=payment.store_id
    and metadata->>'order_id'=payment.id::text
    and kind=case when kind_value='credit' then 'transaction_fee_refund' else 'transaction_fee' end) then return null; end if;
  if kind_value='credit' then
    select * into original from public.platform_fee_documents where order_id=payment.id and kind='invoice';
    if not found then original:=public.issue_platform_fee_document(payment.id,'invoice'); end if;
    if original.id is null then raise exception 'ORIGINAL_PLATFORM_INVOICE_MISSING'; end if;
    captured:=original.snapshot;
  else
    merchant:=payment.invoice_snapshot->'seller';
    if merchant is null or nullif(btrim(merchant->>'name'),'') is null
      or nullif(btrim(merchant->>'address'),'') is null or nullif(btrim(merchant->>'email'),'') is null then
      raise exception 'PLATFORM_INVOICE_BUYER_MISSING';
    end if;
    if payment.stripe_platform_fee_net_cents+payment.stripe_platform_fee_vat_cents<>payment.stripe_platform_fee_cents
      or payment.stripe_platform_fee_vat_cents<>round(payment.stripe_platform_fee_net_cents*0.24)::integer then
      raise exception 'PLATFORM_INVOICE_TAX_MISMATCH';
    end if;
    captured:=jsonb_build_object('version',1,'purpose','platform_fee','currency','eur',
      'seller',jsonb_build_object('type','company','name','Animaator OÜ','registryCode','17135632',
        'address','Alle, Pudisoo küla, Kuusalu vald, Harju maakond 74626, Eesti',
        'email','info@poeruum.ee','vatNumber','EE103036036'),
      'buyer',jsonb_build_object('name',merchant->>'name','address',merchant->>'address','email',merchant->>'email',
        'company',coalesce(merchant->>'type','company')='company',
        'registryCode',case when merchant->>'type'='entrepreneur' then '' else coalesce(merchant->>'registryCode','') end,
        'vatNumber',case when merchant->>'type'='entrepreneur' then '' else coalesce(merchant->>'vatNumber','') end),
      'storeName','Poeruum','storeSlug','','storeAccent','#e5f25a','storeLogo','','sellerEmail','info@poeruum.ee',
      'delivery','Digitaalne teenus','vatRate',24,
      'netCents',payment.stripe_platform_fee_net_cents,'vatCents',payment.stripe_platform_fee_vat_cents,
      'totalCents',payment.stripe_platform_fee_cents,
      'lines',jsonb_build_array(jsonb_build_object('kind','product','name','Poeruumi müügitasu',
        'options','Tellimus '||payment.order_number,'quantity',1,'unitGrossCents',payment.stripe_platform_fee_cents,
        'grossCents',payment.stripe_platform_fee_cents,'netCents',payment.stripe_platform_fee_net_cents,
        'vatCents',payment.stripe_platform_fee_vat_cents)));
  end if;
  insert into public.platform_invoice_sequences(stripe_mode,year,last_number) values(payment.stripe_mode,year_value,1)
    on conflict(stripe_mode,year) do update set last_number=public.platform_invoice_sequences.last_number+1
    returning last_number into sequence_value;
  insert into public.platform_fee_documents(order_id,store_id,order_number,stripe_mode,kind,number,original_number,paid_at,snapshot)
    values(payment.id,payment.store_id,payment.order_number,payment.stripe_mode,kind_value,
      case when payment.stripe_mode='test' then 'TEST-' else '' end||'PF-'||year_value||'-'||lpad(sequence_value::text,greatest(6,length(sequence_value::text)),'0'),
      original.number,payment.invoice_paid_at,captured) returning * into document;
  update public.orders set retention_expires_at=greatest(retention_expires_at,
    ((now() at time zone 'Europe/Tallinn')::date+interval '8 years')::date) where id=payment.id;
  return document;
end;
$$;

create function public.issue_settled_platform_fee_document()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.kind in ('transaction_fee','transaction_fee_refund') and new.metadata->>'order_id' is not null then
    perform public.issue_platform_fee_document((new.metadata->>'order_id')::uuid,
      case when new.kind='transaction_fee_refund' then 'credit' else 'invoice' end);
  end if;
  return new;
end;
$$;
create trigger revenue_events_platform_invoice after insert on public.revenue_events
  for each row execute function public.issue_settled_platform_fee_document();

create function public.claim_platform_fee_document(mode_value text,target_document_id uuid default null)
returns setof public.platform_fee_documents language plpgsql security definer set search_path='' as $$
begin
  return query with candidate as (
    select id from public.platform_fee_documents where stripe_mode=mode_value and status in ('pending','processing','retry')
      and (target_document_id is null or id=target_document_id) and next_attempt_at<=now()
      and (lease_expires_at is null or lease_expires_at<=now())
    order by next_attempt_at,issued_at limit 1 for update skip locked
  ) update public.platform_fee_documents doc set status='processing',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes'
    from candidate where doc.id=candidate.id returning doc.*;
end;
$$;
create function public.finish_platform_fee_document(target_document_id uuid,token_value uuid,outcome_value text,sha256_value text default null,error_value text default null)
returns public.platform_fee_documents language plpgsql security definer set search_path='' as $$
declare document public.platform_fee_documents%rowtype;
begin
  if outcome_value is null or outcome_value not in ('ready','retry','needs_review')
    or outcome_value='ready' and coalesce(sha256_value,'') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_DOCUMENT_OUTCOME'; end if;
  update public.platform_fee_documents set status=outcome_value,pdf_sha256=coalesce(sha256_value,pdf_sha256),
    lease_token=null,lease_expires_at=null,last_error=left(error_value,500),
    next_attempt_at=now()+make_interval(secs=>least(3600,15*power(2,least(attempts,8)))::integer)
  where id=target_document_id and token_value is not null and lease_token=token_value and lease_expires_at>now()
  returning * into document;
  if not found then raise exception 'DOCUMENT_LEASE_LOST'; end if;
  return document;
end;
$$;
revoke all on function public.issue_platform_fee_document(uuid,text),public.issue_settled_platform_fee_document(),
  public.claim_platform_fee_document(text,uuid),public.finish_platform_fee_document(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.issue_platform_fee_document(uuid,text),public.claim_platform_fee_document(text,uuid),
  public.finish_platform_fee_document(uuid,uuid,text,text,text) to service_role;

-- Backfill only settled, captured post-registration sales, never reconstruct
-- a historical merchant identity or legalise pre-registration VAT charges.
do $$ declare payment record;
begin
  for payment in select id,payment_status from public.orders where stripe_transfer_id is not null
    and invoice_snapshot is not null and invoice_paid_at>=timestamptz '2026-10-01 00:00:00 Europe/Tallinn'
    and stripe_platform_fee_cents>0 and payment_status in ('paid','refunded') loop
    perform public.issue_platform_fee_document(payment.id,'invoice');
    if payment.payment_status='refunded' then perform public.issue_platform_fee_document(payment.id,'credit'); end if;
  end loop;
end;
$$;

-- Preserve captured fees; apply both monthly ceilings to new reservations.
create or replace function public.create_stripe_order_with_reservation(
  target_store_id uuid,
  request_id text,
  order_number_value text,
  order_items jsonb,
  customer_name_value text,
  customer_email_value text,
  delivery_value text,
  product_subtotal_value numeric,
  total_value numeric,
  stripe_mode_value text,
  reservation_expires_at_value timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_order public.orders%rowtype;
  created_order public.orders%rowtype;
  grouped_item jsonb;
  product_row public.products%rowtype;
  store_pricing_plan text;
  requested_quantity integer;
  reserved_quantity bigint;
  fee_period_start date;
  reserved_fee_net_cents bigint := 0;
  reserved_fee_gross_cents bigint := 0;
  fee_net_cents integer := 0;
  fee_vat_cents integer := 0;
  fee_vat_percent integer := public.platform_vat_percent(now());
  fee_gross_cap integer := 3900 + round(3900 * public.platform_vat_percent(now()) / 100.0)::integer;
begin
  if request_id is null or char_length(request_id) < 16 or char_length(request_id) > 100 then
    raise exception 'INVALID_CHECKOUT_REQUEST';
  end if;
  if stripe_mode_value not in ('test', 'live') then
    raise exception 'INVALID_STRIPE_MODE';
  end if;
  if jsonb_typeof(order_items) <> 'array' or jsonb_array_length(order_items) = 0 then
    raise exception 'INVALID_ORDER_ITEMS';
  end if;
  if reservation_expires_at_value is null or reservation_expires_at_value <= now() then
    raise exception 'INVALID_RESERVATION_EXPIRY';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_store_id::text, 0));

  select public.effective_store_pricing_plan(target_store_id)
  into store_pricing_plan;
  if store_pricing_plan is null then raise exception 'STORE_UNAVAILABLE'; end if;

  select * into existing_order
  from public.orders
  where store_id = target_store_id and checkout_request_id = request_id for update;
  if found then
    if existing_order.items <> order_items
      or existing_order.customer_name <> customer_name_value
      or existing_order.customer_email <> customer_email_value
      or existing_order.delivery <> delivery_value
      or existing_order.product_subtotal <> product_subtotal_value
      or existing_order.total <> total_value
      or existing_order.stripe_mode <> stripe_mode_value then
      raise exception 'CHECKOUT_REQUEST_REUSED';
    end if;
    -- An attempt is never reused for another payment, including after a refund.
    return existing_order;
  end if;

  for grouped_item in
    select jsonb_build_object(
      'id', item ->> 'id',
      'quantity', sum(greatest(1, coalesce((item ->> 'quantity')::integer, 1)))
    )
    from jsonb_array_elements(order_items) item
    group by item ->> 'id'
  loop
    requested_quantity := (grouped_item ->> 'quantity')::integer;
    select * into product_row
    from public.products
    where store_id = target_store_id and id = grouped_item ->> 'id'
    for update;

    if not found then raise exception 'PRODUCT_UNAVAILABLE:%', grouped_item ->> 'id'; end if;
    if product_row.stock is not null or product_row.one_of_a_kind then
      select coalesce(sum(greatest(1, (reserved_item ->> 'quantity')::integer)), 0)
      into reserved_quantity
      from public.orders reserved_order
      cross join lateral jsonb_array_elements(reserved_order.items) reserved_item
      where reserved_order.store_id = target_store_id
        and reserved_order.payment_status = 'pending'
        and (
          reserved_order.reservation_expires_at > now()
          or reserved_order.stripe_checkout_session_id is not null
          or reserved_order.stripe_checkout_started_at is not null
        )
        and reserved_item ->> 'id' = product_row.id;

      if requested_quantity + reserved_quantity > (case when product_row.one_of_a_kind then 1 else product_row.stock end) then
        raise exception 'INSUFFICIENT_STOCK:%', product_row.name;
      end if;
    end if;
  end loop;

  fee_period_start := date_trunc('month', now() at time zone 'Europe/Tallinn')::date;
  if store_pricing_plan = 'flexible' then
    select coalesce(sum(candidate.stripe_platform_fee_net_cents), 0),
      coalesce(sum(candidate.stripe_platform_fee_cents), 0)
    into reserved_fee_net_cents, reserved_fee_gross_cents
    from public.orders as candidate
    where candidate.store_id = target_store_id
      and candidate.platform_fee_period_start = fee_period_start
      and candidate.stripe_mode = stripe_mode_value
      and candidate.id is distinct from existing_order.id
      and (
        candidate.payment_status = 'paid'
        or (
          candidate.payment_status = 'pending'
          and (
            candidate.reservation_expires_at > now()
            or candidate.stripe_checkout_session_id is not null
            or candidate.stripe_checkout_started_at is not null
          )
        )
      );

    fee_net_cents := least(
      round(product_subtotal_value * 100 * 0.04)::integer,
      greatest(0, 3900 - reserved_fee_net_cents)::integer,
      -- Respect the registration date and individually rounded gross cap.
      ((greatest(0, fee_gross_cap - reserved_fee_gross_cents) * 100 + 49) / (100 + fee_vat_percent))::integer
    );
    fee_vat_cents := round(fee_net_cents * fee_vat_percent / 100.0)::integer;
  end if;

  insert into public.orders (
    store_id, order_number, items, customer_name, customer_email, delivery,
    product_subtotal, total, payment_status, checkout_request_id,
    reservation_expires_at, stripe_mode, stripe_platform_fee_net_cents,
    stripe_platform_fee_vat_cents, stripe_platform_fee_cents,
    platform_fee_period_start
  ) values (
    target_store_id, order_number_value, order_items, customer_name_value,
    customer_email_value, delivery_value, product_subtotal_value, total_value,
    'pending', request_id, reservation_expires_at_value, stripe_mode_value,
    fee_net_cents, fee_vat_cents, fee_net_cents + fee_vat_cents,
    fee_period_start
  ) returning * into created_order;

  return created_order;
end;
$$;

revoke all on function public.create_stripe_order_with_reservation(uuid, text, text, jsonb, text, text, text, numeric, numeric, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_stripe_order_with_reservation(uuid, text, text, jsonb, text, text, text, numeric, numeric, text, timestamptz) to service_role;

create or replace function public.admin_revenue_dashboard()
returns table (
  month_total_cents bigint,
  today_total_cents bigint,
  subscription_total_cents bigint,
  transaction_fee_total_cents bigint,
  refund_total_cents bigint,
  recent_events jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  with live_events as (
    select event.* from public.revenue_events event
    where event.metadata->>'livemode' is distinct from 'false'
      and event.metadata->>'stripe_mode' is distinct from 'test'
      and not exists(select 1 from public.orders payment where payment.id::text=event.metadata->>'order_id' and payment.stripe_mode='test')
  ), month_events as (
    select event.*
    from live_events as event
    where (event.occurred_at at time zone 'Europe/Tallinn')::date
      >= date_trunc('month', now() at time zone 'Europe/Tallinn')::date
  ), recent as (
    select jsonb_agg(to_jsonb(item) order by item.occurred_at desc) as events
    from (
      select
        event.id,
        event.kind,
        event.amount_cents,
        event.currency,
        event.description,
        event.occurred_at,
        event.store_id,
        coalesce(store.name, 'Tundmatu pood') as store_name
      from live_events as event
      left join public.stores as store on store.id = event.store_id
      order by event.occurred_at desc
      limit 8
    ) as item
  )
  select
    coalesce(sum(event.amount_cents), 0)::bigint,
    coalesce(sum(event.amount_cents) filter (
      where (event.occurred_at at time zone 'Europe/Tallinn')::date = (now() at time zone 'Europe/Tallinn')::date
    ), 0)::bigint,
    coalesce(sum(event.amount_cents) filter (where event.kind = 'subscription' and event.metadata->>'billing_adjustment' is null), 0)::bigint,
    coalesce(sum(event.amount_cents) filter (where event.kind = 'transaction_fee'), 0)::bigint,
    coalesce(sum(event.amount_cents) filter (where event.kind = 'transaction_fee_refund' or event.metadata->>'billing_adjustment'='credit_note'), 0)::bigint,
    coalesce((select recent.events from recent), '[]'::jsonb)
  from month_events as event;
end;
$$;

revoke all on function public.admin_revenue_dashboard() from public, anon;
grant execute on function public.admin_revenue_dashboard() to authenticated;
