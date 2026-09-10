-- An outbound Checkout request may have succeeded even if its response was lost.
alter table public.orders add column stripe_checkout_started_at timestamptz,
  add column stripe_failure_verified_at timestamptz;
update public.orders set stripe_checkout_started_at = created_at
where payment_status = 'pending' and stripe_mode is not null;

create table public.stripe_checkout_attempts (
  order_id uuid primary key references public.orders(id) on delete cascade,
  payload jsonb not null,
  started_at timestamptz not null default now()
);
alter table public.stripe_checkout_attempts enable row level security;
revoke all on public.stripe_checkout_attempts from public, anon, authenticated;
grant select on public.stripe_checkout_attempts to service_role;

create function public.prepare_stripe_checkout(target_order_id uuid, payload_value jsonb)
returns public.stripe_checkout_attempts language plpgsql security definer set search_path = '' as $$
declare target public.orders%rowtype; attempt public.stripe_checkout_attempts%rowtype;
begin
  select * into target from public.orders where id = target_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.payment_status <> 'pending' then raise exception 'CHECKOUT_NOT_PENDING'; end if;
  select * into attempt from public.stripe_checkout_attempts where order_id = target_order_id;
  if found then return attempt; end if;
  if target.reservation_expires_at is null or target.reservation_expires_at <= now() then raise exception 'CHECKOUT_EXPIRED'; end if;
  if target.stripe_checkout_started_at is not null then raise exception 'CHECKOUT_RESULT_UNCERTAIN'; end if;
  if payload_value->>'mode' is distinct from 'payment'
    or payload_value#>>'{metadata,order_id}' is distinct from target.id::text
    or payload_value#>>'{metadata,store_id}' is distinct from target.store_id::text
    or payload_value#>>'{metadata,stripe_mode}' is distinct from target.stripe_mode
    or to_timestamp((payload_value->>'expires_at')::bigint) <= now()
    or payload_value->>'expires_at' is null then raise exception 'INVALID_CHECKOUT_PAYLOAD'; end if;
  insert into public.stripe_checkout_attempts(order_id,payload) values(target_order_id,payload_value) returning * into attempt;
  update public.orders set stripe_checkout_started_at = attempt.started_at where id = target_order_id;
  return attempt;
end;
$$;

create function public.bind_stripe_checkout(target_order_id uuid, session_id_value text, mode_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.orders%rowtype;
begin
  select * into target from public.orders where id = target_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.stripe_mode is distinct from mode_value or nullif(session_id_value,'') is null
    or (target.stripe_checkout_session_id is not null and target.stripe_checkout_session_id <> session_id_value) then
    raise exception 'ORDER_PAYMENT_MISMATCH'; end if;
  update public.orders set stripe_checkout_session_id = session_id_value,
    stripe_checkout_started_at = coalesce(stripe_checkout_started_at,now()) where id = target_order_id;
end;
$$;

-- Raw event metadata and a missing HTTP response are not proof of non-payment.
create or replace function public.release_stripe_order(target_order_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.orders set payment_status = 'failed', reservation_expires_at = null, stripe_failure_verified_at = now()
  where id = target_order_id and payment_status = 'pending'
    and stripe_checkout_started_at is null and stripe_checkout_session_id is null and stripe_payment_intent_id is null;
$$;

create function public.release_verified_stripe_order(target_order_id uuid, session_id_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.orders%rowtype;
begin
  select * into target from public.orders where id = target_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.payment_status in ('paid','refunded') then return; end if;
  if target.stripe_checkout_session_id is distinct from session_id_value or nullif(session_id_value,'') is null then
    raise exception 'ORDER_PAYMENT_MISMATCH'; end if;
  update public.orders set payment_status = 'failed', reservation_expires_at = null, stripe_failure_verified_at = now() where id = target_order_id and payment_status = 'pending';
end;
$$;

create function public.release_absent_stripe_checkout(target_order_id uuid, scanned_until_value timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.orders%rowtype; expires timestamptz;
begin
  select * into target from public.orders where id = target_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.payment_status in ('paid','refunded') then return; end if;
  select to_timestamp((payload->>'expires_at')::bigint) into expires from public.stripe_checkout_attempts where order_id = target_order_id;
  -- Called only after a fully paginated Stripe scan found no matching session.
  -- The immutable request is now too old for Stripe to create a new session.
  if expires is null or expires + interval '1 minute' > now() or scanned_until_value is null
    or scanned_until_value < expires or target.stripe_checkout_session_id is not null
    or target.stripe_payment_intent_id is not null then raise exception 'CHECKOUT_RESULT_UNCERTAIN'; end if;
  update public.orders set payment_status = 'failed', reservation_expires_at = null, stripe_failure_verified_at = now() where id = target_order_id and payment_status = 'pending';
end;
$$;

create or replace function public.release_expired_unstarted_stripe_orders(batch_size_value integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare released_count integer;
begin
  with expired as (
    select id from public.orders where payment_status = 'pending' and reservation_expires_at <= now()
      and stripe_checkout_session_id is null and stripe_checkout_started_at is null and stripe_payment_intent_id is null
    order by reservation_expires_at limit greatest(1,least(coalesce(batch_size_value,100),500)) for update skip locked
  ) update public.orders target set payment_status = 'failed', reservation_expires_at = null, stripe_failure_verified_at = now() from expired where target.id = expired.id;
  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

create table public.order_payment_recovery (
  order_id uuid primary key references public.orders(id) on delete cascade,
  stripe_mode text not null check(stripe_mode in ('live','test')),
  status text not null default 'pending' check(status in ('pending','processing','waiting','retry','completed','needs_review')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default (now() + interval '1 minute'),
  lease_token uuid, lease_expires_at timestamptz,
  scan_cursor text, scan_match_id text, scan_until timestamptz,
  last_error text, updated_at timestamptz not null default now()
);
alter table public.order_payment_recovery enable row level security;
revoke all on public.order_payment_recovery from public, anon, authenticated;
grant select on public.order_payment_recovery to service_role;
create index order_payment_recovery_due on public.order_payment_recovery(stripe_mode,next_attempt_at)
  where status not in ('completed','needs_review');
create function public.enqueue_order_payment_recovery()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stripe_mode is not null and new.payment_status in ('pending','paid') then
    insert into public.order_payment_recovery(order_id,stripe_mode) values(new.id,new.stripe_mode) on conflict(order_id) do update set status='pending',next_attempt_at=now()
      where public.order_payment_recovery.status='completed' and new.payment_status='paid';
  end if;
  return new;
end;
$$;
create trigger orders_enqueue_payment_recovery after insert or update of payment_status on public.orders
  for each row execute function public.enqueue_order_payment_recovery();
insert into public.order_payment_recovery(order_id,stripe_mode)
select id,stripe_mode from public.orders where stripe_mode is not null and payment_status in ('pending','failed','paid');

create function public.claim_order_payment_recovery(mode_value text)
returns setof public.order_payment_recovery language plpgsql security definer set search_path = '' as $$
begin
  return query with candidate as (
    select order_id from public.order_payment_recovery where stripe_mode = mode_value
      and status not in ('completed','needs_review') and next_attempt_at <= now()
      and (lease_expires_at is null or lease_expires_at <= now())
    order by next_attempt_at,order_id limit 1 for update skip locked
  ) update public.order_payment_recovery job set status='processing', attempts=attempts+1,
    lease_token=gen_random_uuid(), lease_expires_at=now()+interval '5 minutes',updated_at=now()
    from candidate where job.order_id=candidate.order_id returning job.*;
end;
$$;
create function public.finish_order_payment_recovery(target_order_id uuid, token_value uuid, outcome_value text,
  error_value text default null, scan_cursor_value text default null, scan_match_value text default null, scan_until_value timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if outcome_value not in ('pending','waiting','retry','completed','needs_review') then raise exception 'INVALID_RECOVERY_OUTCOME'; end if;
  update public.order_payment_recovery set status=outcome_value, lease_token=null,lease_expires_at=null,
    next_attempt_at=now()+case when outcome_value='pending' then interval '1 second'
      when outcome_value='waiting' then interval '1 minute'
      else make_interval(secs=>least(900,30*power(2,least(attempts,5)))::integer) end,
    scan_cursor=scan_cursor_value,scan_match_id=scan_match_value,scan_until=scan_until_value,
    last_error=left(error_value,500),updated_at=now()
  where order_id=target_order_id and token_value is not null and lease_token=token_value and lease_expires_at>now();
  if not found then raise exception 'RECOVERY_LEASE_LOST'; end if;
end;
$$;

create function public.repair_paid_order_jobs(target_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.orders%rowtype; settings_value jsonb;
begin
  select * into target from public.orders where id=target_order_id for update;
  if not found or target.payment_status <> 'paid' or target.stripe_mode is null or target.stripe_payment_intent_id is null then return; end if;
  select settings into settings_value from public.stores where id=target.store_id;
  insert into public.stripe_order_settlements(order_id,stripe_mode,status,completed_at)
  values(target.id,target.stripe_mode,case when target.stripe_transfer_id is null then 'pending' else 'completed' end,
    case when target.stripe_transfer_id is not null then now() end) on conflict do nothing;
  insert into public.order_email_jobs(order_id,kind,stripe_mode,status,accepted_at,legacy_import,last_error)
  select target.id,kind,target.stripe_mode,
    case when sent_at is not null then 'accepted' when settings_value->setting_key = 'false'::jsonb then 'skipped' else 'needs_review' end,
    sent_at,true,case when sent_at is null then 'Puuduva saatmisülesande varasem tulemus vajab kontrollimist.' end
  from (values ('customer',target.customer_confirmation_sent_at,'customerConfirmations'),
    ('seller',target.seller_notification_sent_at,'sellerNotifications')) recipient(kind,sent_at,setting_key)
  on conflict(order_id,kind) do nothing;
end;
$$;

alter table public.stripe_webhook_events
  add column payload jsonb,
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column attempts integer not null default 0,
  add column next_attempt_at timestamptz not null default now(),
  add column recovery_status text not null default 'retry' check(recovery_status in ('retry','processing','completed','needs_review')),
  add column last_error text;
update public.stripe_webhook_events set recovery_status='completed' where processed_at is not null;
grant select on public.stripe_webhook_events to service_role;
create index stripe_webhook_recovery_due on public.stripe_webhook_events(livemode,next_attempt_at)
  where source='account' and processed_at is null and recovery_status<>'needs_review';

create function public.claim_stripe_webhook(event_id_value text, source_value text, event_type_value text,
  livemode_value boolean, connected_account_value text, payload_value jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.stripe_webhook_events%rowtype; token uuid;
begin
  if payload_value->>'id' is distinct from event_id_value or payload_value->>'type' is distinct from event_type_value
    or (payload_value->>'livemode')::boolean is distinct from livemode_value then raise exception 'WEBHOOK_EVENT_MISMATCH'; end if;
  insert into public.stripe_webhook_events(event_id,source,event_type,livemode,connected_account_id,payload)
  values(event_id_value,source_value,event_type_value,livemode_value,connected_account_value,payload_value) on conflict do nothing;
  select * into target from public.stripe_webhook_events where event_id=event_id_value for update;
  if target.source<>source_value or target.event_type<>event_type_value or target.livemode<>livemode_value
    or target.connected_account_id is distinct from connected_account_value then raise exception 'WEBHOOK_EVENT_MISMATCH'; end if;
  if target.processed_at is not null then return jsonb_build_object('state','processed'); end if;
  if target.lease_expires_at>now() or target.next_attempt_at>now() then return jsonb_build_object('state','busy'); end if;
  token:=gen_random_uuid();
  update public.stripe_webhook_events set payload=coalesce(payload,payload_value),lease_token=token,
    lease_expires_at=now()+interval '10 minutes',attempts=attempts+1,recovery_status='processing' where event_id=event_id_value;
  return jsonb_build_object('state','claimed','token',token);
end;
$$;
create function public.claim_stored_stripe_webhook(mode_value text)
returns setof public.stripe_webhook_events language plpgsql security definer set search_path = '' as $$
begin
  return query with candidate as (
    select event_id from public.stripe_webhook_events where source='account' and livemode=(mode_value='live')
      and processed_at is null and recovery_status<>'needs_review' and next_attempt_at<=now()
      and (lease_expires_at is null or lease_expires_at<=now())
      and event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded',
        'checkout.session.expired','checkout.session.async_payment_failed','charge.updated','refund.updated','refund.failed')
    order by next_attempt_at,event_id limit 1 for update skip locked
  ) update public.stripe_webhook_events event set lease_token=gen_random_uuid(),lease_expires_at=now()+interval '10 minutes',
    attempts=attempts+1,recovery_status='processing' from candidate where event.event_id=candidate.event_id returning event.*;
end;
$$;
create function public.finish_stripe_webhook(event_id_value text, token_value uuid, outcome_value text, error_value text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if outcome_value not in ('completed','retry','needs_review') then raise exception 'INVALID_WEBHOOK_OUTCOME'; end if;
  update public.stripe_webhook_events set recovery_status=outcome_value,
    processed_at=case when outcome_value='completed' then now() else null end,
    lease_token=null,lease_expires_at=null,last_error=left(error_value,500),
    next_attempt_at=now()+make_interval(secs=>least(3600,15*power(2,least(attempts,8)))::integer)
  where event_id=event_id_value and token_value is not null and lease_token=token_value and lease_expires_at>now();
  if not found then raise exception 'WEBHOOK_LEASE_LOST'; end if;
end;
$$;

do $$
declare fn regprocedure;
begin
  foreach fn in array array[
    'public.prepare_stripe_checkout(uuid,jsonb)'::regprocedure,'public.bind_stripe_checkout(uuid,text,text)'::regprocedure,
    'public.release_verified_stripe_order(uuid,text)'::regprocedure,'public.release_absent_stripe_checkout(uuid,timestamptz)'::regprocedure,
    'public.enqueue_order_payment_recovery()'::regprocedure,'public.claim_order_payment_recovery(text)'::regprocedure,
    'public.finish_order_payment_recovery(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure,
    'public.repair_paid_order_jobs(uuid)'::regprocedure,'public.claim_stripe_webhook(text,text,text,boolean,text,jsonb)'::regprocedure,
    'public.claim_stored_stripe_webhook(text)'::regprocedure,'public.finish_stripe_webhook(text,uuid,text,text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',fn);
    execute format('grant execute on function %s to service_role',fn);
  end loop;
end;
$$;

do $$
declare reminder_url text; existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='poeruum-payment-recovery';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  select decrypted_secret into reminder_url from vault.decrypted_secrets where name='onboarding_reminders_url' limit 1;
  if reminder_url is null or position('/onboarding-reminders' in reminder_url)=0
    or not exists(select 1 from vault.decrypted_secrets where name='onboarding_cron_secret' and nullif(trim(decrypted_secret),'') is not null) then
    raise notice 'Payment recovery schedule skipped because Vault secrets are not configured.'; return;
  end if;
  for existing_job in select jobid from cron.job where command like '%/stripe-reservation-reaper%' loop
    perform cron.unschedule(existing_job);
  end loop;
  perform cron.schedule('poeruum-payment-recovery','* * * * *',$schedule$
    select net.http_post(
      url:=replace((select decrypted_secret from vault.decrypted_secrets where name='onboarding_reminders_url' limit 1),'/onboarding-reminders','/stripe-reservation-reaper'),
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='onboarding_cron_secret' limit 1)),
      body:='{}'::jsonb,timeout_milliseconds:=120000);
  $schedule$);
end;
$$;

-- Preserve stock and fee reservations across an uncertain outbound request.
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
  fee_net_cents integer := 0;
  fee_vat_cents integer := 0;
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
    select coalesce(sum(candidate.stripe_platform_fee_net_cents), 0)
    into reserved_fee_net_cents
    from public.orders as candidate
    where candidate.store_id = target_store_id
      and candidate.platform_fee_period_start = fee_period_start
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
      greatest(0, 3900 - reserved_fee_net_cents)::integer
    );
    fee_vat_cents := round(fee_net_cents * 0.24)::integer;
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

