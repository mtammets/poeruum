alter table public.orders
  add column if not exists stripe_refund_status text
    check (stripe_refund_status in ('requested', 'pending', 'succeeded', 'failed')),
  add column if not exists stripe_refund_id text;

create table public.stripe_order_settlements (
  order_id uuid primary key references public.orders(id) on delete cascade,
  stripe_mode text not null check (stripe_mode in ('test', 'live')),
  status text not null default 'pending' check (status in (
    'pending', 'waiting_for_fee', 'processing', 'retry', 'completed', 'refund_pending', 'refunded', 'needs_review'
  )),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  transfer_payload jsonb,
  settlement_data jsonb,
  transfer_started_at timestamptz,
  refund_requested_at timestamptz,
  refund_payload jsonb,
  refund_started_at timestamptz,
  stripe_refund_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index stripe_order_settlements_due_idx
  on public.stripe_order_settlements(stripe_mode, next_attempt_at)
  where status not in ('completed', 'refunded', 'needs_review');
create trigger stripe_order_settlements_updated_at before update on public.stripe_order_settlements
  for each row execute function public.set_updated_at();
alter table public.stripe_order_settlements enable row level security;
revoke all on public.stripe_order_settlements from public, anon, authenticated;
grant select, insert, update, delete on public.stripe_order_settlements to service_role;

-- The job commits or rolls back with the paid order and its stock adjustment.
create function public.enqueue_paid_order_settlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_status = 'paid' and new.stripe_payment_intent_id is not null and new.stripe_mode is not null then
    insert into public.stripe_order_settlements(order_id, stripe_mode, status, completed_at)
    values (new.id, new.stripe_mode,
      case when new.stripe_transfer_id is null then 'pending' else 'completed' end,
      case when new.stripe_transfer_id is null then null else now() end)
    on conflict (order_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_paid_order_settlement() from public, anon, authenticated;
create trigger orders_enqueue_settlement after insert or update of payment_status, stripe_payment_intent_id on public.orders
  for each row execute function public.enqueue_paid_order_settlement();

insert into public.stripe_order_settlements(order_id, stripe_mode, status, completed_at)
select id, stripe_mode, case when stripe_transfer_id is null then 'pending' else 'completed' end,
  case when stripe_transfer_id is null then null else updated_at end
from public.orders where payment_status = 'paid' and stripe_payment_intent_id is not null and stripe_mode is not null
on conflict (order_id) do nothing;

create function public.claim_stripe_order_settlement(mode_value text, target_order_id uuid default null)
returns setof public.stripe_order_settlements
language plpgsql security definer set search_path = '' as $$
declare claimed_order_id uuid;
begin
  if mode_value is null or mode_value not in ('test', 'live') then raise exception 'INVALID_STRIPE_MODE'; end if;
  select job.order_id into claimed_order_id from public.stripe_order_settlements job
  where job.stripe_mode = mode_value
    and (target_order_id is null or job.order_id = target_order_id)
    and job.status not in ('completed', 'refunded', 'needs_review')
    and (target_order_id is not null or job.next_attempt_at <= now())
    and (job.lease_expires_at is null or job.lease_expires_at <= now())
  order by job.next_attempt_at, job.created_at
  for update skip locked limit 1;
  if claimed_order_id is null then return; end if;
  return query update public.stripe_order_settlements
    set status = 'processing', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes',
      attempts = attempts + 1
    where order_id = claimed_order_id returning *;
end;
$$;

create function public.request_stripe_order_refund(target_order_id uuid, mode_value text)
returns public.stripe_order_settlements
language plpgsql security definer set search_path = '' as $$
declare payment public.orders%rowtype; job public.stripe_order_settlements%rowtype;
begin
  select * into payment from public.orders where id = target_order_id for update;
  if not found or payment.payment_status not in ('paid', 'refunded') or payment.stripe_payment_intent_id is null then
    raise exception 'ORDER_NOT_REFUNDABLE';
  end if;
  if mode_value is null or mode_value not in ('test', 'live') or (payment.stripe_mode is not null and payment.stripe_mode <> mode_value) then
    raise exception 'INVALID_STRIPE_MODE';
  end if;
  insert into public.stripe_order_settlements(order_id, stripe_mode)
    values (payment.id, mode_value) on conflict (order_id) do nothing;
  select * into job from public.stripe_order_settlements where order_id = payment.id for update;
  if job.stripe_mode <> mode_value then raise exception 'INVALID_STRIPE_MODE'; end if;
  if payment.payment_status = 'refunded' or job.status in ('refunded', 'needs_review') then return job; end if;
  update public.orders set stripe_refund_status = coalesce(stripe_refund_status, 'requested') where id = payment.id;
  update public.stripe_order_settlements
    set refund_requested_at = coalesce(refund_requested_at, now()), next_attempt_at = now(),
      status = case when lease_expires_at > now() then status else 'pending' end,
      completed_at = null
    where order_id = payment.id returning * into job;
  return job;
end;
$$;

-- A prepared payload is immutable and means the Stripe request may have run.
-- A replacement worker must reconcile/replay that SAME operation before refunding.
create function public.prepare_stripe_order_operation(
  target_order_id uuid, token_value uuid, operation_value text, payload_value jsonb, settlement_value jsonb default null
)
returns public.stripe_order_settlements
language plpgsql security definer set search_path = '' as $$
declare job public.stripe_order_settlements%rowtype; payment public.orders%rowtype;
begin
  select * into job from public.stripe_order_settlements where order_id = target_order_id for update;
  if not found or token_value is null or job.lease_token is distinct from token_value
    or job.lease_expires_at is null or job.lease_expires_at <= now() then
    raise exception 'SETTLEMENT_LEASE_LOST';
  end if;
  select * into payment from public.orders where id = target_order_id;
  if jsonb_typeof(payload_value) is distinct from 'object' then raise exception 'INVALID_OPERATION_PAYLOAD'; end if;
  if operation_value = 'transfer' then
    if job.transfer_payload is null and job.refund_requested_at is null then
      if jsonb_typeof(settlement_value) is distinct from 'object'
        or payload_value ->> 'transfer_group' is distinct from 'order_' || target_order_id::text
        or payload_value ->> 'currency' is distinct from 'eur'
        or payload_value #>> '{metadata,order_id}' is distinct from target_order_id::text
        or payload_value #>> '{metadata,store_id}' is distinct from payment.store_id::text
        or payload_value #>> '{metadata,payment_intent_id}' is distinct from payment.stripe_payment_intent_id
        or coalesce(payload_value ->> 'destination', '') not like 'acct\_%' escape '\'
        or coalesce(payload_value ->> 'source_transaction', '') not like 'ch\_%' escape '\'
        or coalesce((payload_value ->> 'amount')::integer, 0) <= 0
        or (payload_value ->> 'amount')::integer is distinct from (settlement_value ->> 'seller_net_cents')::integer
        or coalesce((settlement_value ->> 'processing_fee_cents')::integer, -1) < 0
        or coalesce((settlement_value ->> 'platform_fee_net_cents')::integer, -1) < 0
        or coalesce((settlement_value ->> 'platform_fee_vat_cents')::integer, -1) < 0
        or (settlement_value ->> 'seller_net_cents')::integer + (settlement_value ->> 'processing_fee_cents')::integer
          + (settlement_value ->> 'platform_fee_net_cents')::integer + (settlement_value ->> 'platform_fee_vat_cents')::integer
          is distinct from round(payment.total * 100)::integer
      then raise exception 'INVALID_TRANSFER_PAYLOAD'; end if;
      update public.stripe_order_settlements set transfer_payload = payload_value,
        settlement_data = settlement_value, transfer_started_at = now()
        where order_id = target_order_id returning * into job;
    end if;
  elsif operation_value = 'refund' then
    if job.refund_requested_at is null then raise exception 'REFUND_NOT_REQUESTED'; end if;
    if payload_value ->> 'payment_intent' is distinct from payment.stripe_payment_intent_id
      or payload_value #>> '{metadata,order_id}' is distinct from target_order_id::text
      or payload_value ? 'amount' then raise exception 'INVALID_REFUND_PAYLOAD'; end if;
    if job.refund_payload is null then
      update public.stripe_order_settlements set refund_payload = payload_value, refund_started_at = now()
        where order_id = target_order_id returning * into job;
    end if;
  else raise exception 'INVALID_OPERATION';
  end if;
  return job;
end;
$$;

create function public.record_stripe_order_transfer(target_order_id uuid, token_value uuid, transfer_id_value text)
returns public.stripe_order_settlements
language plpgsql security definer set search_path = '' as $$
declare job public.stripe_order_settlements%rowtype; payment public.orders%rowtype; amounts jsonb;
begin
  select * into payment from public.orders where id = target_order_id for update;
  select * into job from public.stripe_order_settlements where order_id = target_order_id for update;
  if not found or token_value is null or job.lease_token is distinct from token_value
    or job.lease_expires_at is null or job.lease_expires_at <= now() then raise exception 'SETTLEMENT_LEASE_LOST'; end if;
  if transfer_id_value is null or transfer_id_value not like 'tr_%' or job.transfer_payload is null then
    raise exception 'INVALID_TRANSFER_REFERENCE';
  end if;
  if payment.stripe_transfer_id is not null and payment.stripe_transfer_id <> transfer_id_value then
    raise exception 'ORDER_TRANSFER_MISMATCH';
  end if;
  amounts := job.settlement_data;
  if (amounts ->> 'seller_net_cents')::integer + (amounts ->> 'processing_fee_cents')::integer
      + (amounts ->> 'platform_fee_net_cents')::integer + (amounts ->> 'platform_fee_vat_cents')::integer
      is distinct from round(payment.total * 100)::integer then raise exception 'SETTLEMENT_AMOUNT_MISMATCH'; end if;
  update public.orders set stripe_transfer_id = transfer_id_value,
    stripe_processing_fee_cents = (amounts ->> 'processing_fee_cents')::integer,
    stripe_platform_fee_net_cents = (amounts ->> 'platform_fee_net_cents')::integer,
    stripe_platform_fee_vat_cents = (amounts ->> 'platform_fee_vat_cents')::integer,
    stripe_platform_fee_cents = (amounts ->> 'platform_fee_net_cents')::integer + (amounts ->> 'platform_fee_vat_cents')::integer,
    stripe_seller_net_cents = (amounts ->> 'seller_net_cents')::integer
    where id = target_order_id;
  if (amounts ->> 'platform_fee_net_cents')::integer > 0 then
    insert into public.revenue_events(provider, provider_event_id, provider_object_id, store_id,
      kind, amount_cents, currency, description, occurred_at, metadata)
    select 'stripe', 'order-settlement:' || target_order_id::text, transfer_id_value, payment.store_id,
      'transaction_fee', (amounts ->> 'platform_fee_net_cents')::integer, 'eur', '4% müügitasu + käibemaks', now(),
      amounts || jsonb_build_object('order_id', target_order_id, 'payment_intent_id', payment.stripe_payment_intent_id,
        'net_amount_cents', (amounts ->> 'platform_fee_net_cents')::integer,
        'vat_amount_cents', (amounts ->> 'platform_fee_vat_cents')::integer,
        'gross_amount_cents', (amounts ->> 'platform_fee_net_cents')::integer + (amounts ->> 'platform_fee_vat_cents')::integer,
        'vat_rate', 24)
    where not exists (select 1 from public.revenue_events
      where provider = 'stripe' and provider_object_id = transfer_id_value and kind = 'transaction_fee')
    on conflict (provider, provider_event_id) do nothing;
  end if;
  return job;
end;
$$;

create function public.finish_stripe_order_settlement(
  target_order_id uuid, token_value uuid, outcome_value text,
  error_value text default null, refund_id_value text default null
)
returns public.stripe_order_settlements
language plpgsql security definer set search_path = '' as $$
declare job public.stripe_order_settlements%rowtype; payment public.orders%rowtype; fee_net integer;
begin
  select * into payment from public.orders where id = target_order_id for update;
  select * into job from public.stripe_order_settlements where order_id = target_order_id for update;
  if not found or token_value is null or job.lease_token is distinct from token_value
    or job.lease_expires_at is null or job.lease_expires_at <= now() then raise exception 'SETTLEMENT_LEASE_LOST'; end if;
  if outcome_value is null or outcome_value not in ('waiting_for_fee', 'retry', 'completed', 'refund_pending', 'refunded', 'needs_review') then
    raise exception 'INVALID_SETTLEMENT_OUTCOME';
  end if;
  if outcome_value = 'completed' and job.refund_requested_at is not null then outcome_value := 'retry'; end if;
  if outcome_value = 'completed' and payment.stripe_transfer_id is null then
    raise exception 'TRANSFER_REFERENCE_REQUIRED';
  end if;
  if outcome_value in ('refund_pending', 'refunded') then
    if job.refund_requested_at is null then raise exception 'REFUND_NOT_REQUESTED'; end if;
    if refund_id_value is null or refund_id_value not like 're\_%' escape '\' then raise exception 'REFUND_REFERENCE_REQUIRED'; end if;
    if job.stripe_refund_id is not null and job.stripe_refund_id <> refund_id_value then raise exception 'ORDER_REFUND_MISMATCH'; end if;
    update public.orders set stripe_refund_id = refund_id_value,
      stripe_refund_status = case when outcome_value = 'refunded' then 'succeeded' else 'pending' end,
      payment_status = case when outcome_value = 'refunded' then 'refunded' else payment_status end,
      status = case when outcome_value = 'refunded' then 'refunded' else status end
      where id = target_order_id;
    if outcome_value = 'refunded' and payment.stripe_transfer_id is not null then
      select coalesce(sum(amount_cents), 0)::integer into fee_net from public.revenue_events
        where provider = 'stripe' and provider_object_id = payment.stripe_transfer_id and kind = 'transaction_fee';
      if fee_net > 0 then
        insert into public.revenue_events(provider, provider_event_id, provider_object_id, store_id,
          kind, amount_cents, currency, description, occurred_at, metadata)
        select 'stripe', 'order-refund:' || target_order_id::text, refund_id_value, payment.store_id,
          'transaction_fee_refund', -fee_net, 'eur', 'Tagastatud müügitasu ja käibemaks', now(),
          jsonb_build_object('order_id', target_order_id, 'refund_id', refund_id_value,
            'transfer_id', payment.stripe_transfer_id, 'net_amount_cents', -fee_net,
            'vat_amount_cents', -payment.stripe_platform_fee_vat_cents,
            'gross_amount_cents', -payment.stripe_platform_fee_cents, 'vat_rate', 24)
        where not exists (select 1 from public.revenue_events
          where provider = 'stripe' and provider_object_id = refund_id_value and kind = 'transaction_fee_refund')
        on conflict (provider, provider_event_id) do nothing;
      end if;
    end if;
  elsif outcome_value = 'needs_review' and job.refund_requested_at is not null then
    update public.orders set stripe_refund_status = 'failed' where id = target_order_id;
  end if;
  update public.stripe_order_settlements set status = outcome_value,
    lease_token = null, lease_expires_at = null, last_error = left(error_value, 500),
    stripe_refund_id = coalesce(refund_id_value, stripe_refund_id),
    next_attempt_at = now() + make_interval(secs => case
      when outcome_value in ('waiting_for_fee', 'refund_pending') then 60
      else least(3600, 15 * power(2, least(attempts, 8))::integer) end),
    completed_at = case when outcome_value in ('completed', 'refunded') then now() else null end
    where order_id = target_order_id returning * into job;
  return job;
end;
$$;

create function public.check_stripe_order_settlement_lease(target_order_id uuid, token_value uuid)
returns public.stripe_order_settlements
language plpgsql security definer set search_path = '' as $$
declare job public.stripe_order_settlements%rowtype;
begin
  select * into job from public.stripe_order_settlements where order_id = target_order_id;
  if not found or token_value is null or job.lease_token is distinct from token_value
    or job.lease_expires_at is null or job.lease_expires_at <= now() then raise exception 'SETTLEMENT_LEASE_LOST'; end if;
  return job;
end;
$$;
revoke all on function public.check_stripe_order_settlement_lease(uuid, uuid) from public, anon, authenticated;
grant execute on function public.check_stripe_order_settlement_lease(uuid, uuid) to service_role;
revoke all on function public.claim_stripe_order_settlement(text, uuid) from public, anon, authenticated;
revoke all on function public.request_stripe_order_refund(uuid, text) from public, anon, authenticated;
revoke all on function public.prepare_stripe_order_operation(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.record_stripe_order_transfer(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_stripe_order_settlement(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_stripe_order_settlement(text, uuid) to service_role;
grant execute on function public.request_stripe_order_refund(uuid, text) to service_role;
grant execute on function public.prepare_stripe_order_operation(uuid, uuid, text, jsonb, jsonb) to service_role;
grant execute on function public.record_stripe_order_transfer(uuid, uuid, text) to service_role;
grant execute on function public.finish_stripe_order_settlement(uuid, uuid, text, text, text) to service_role;

do $$
declare existing_job bigint; reminder_url text;
begin
  select jobid into existing_job from cron.job where jobname = 'poeruum-stripe-order-settlements';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  select decrypted_secret into reminder_url from vault.decrypted_secrets where name = 'onboarding_reminders_url' limit 1;
  if reminder_url is null or position('/onboarding-reminders' in reminder_url) = 0
    or not exists (select 1 from vault.decrypted_secrets where name = 'onboarding_cron_secret'
      and nullif(trim(decrypted_secret), '') is not null) then
    raise notice 'Stripe settlement schedule skipped because Vault secrets are not configured.';
    return;
  end if;
  perform cron.schedule('poeruum-stripe-order-settlements', '* * * * *', $schedule$
    select net.http_post(
      url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_reminders_url' limit 1),
        '/onboarding-reminders', '/stripe-order-settlements'),
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_cron_secret' limit 1)),
      body := '{}'::jsonb, timeout_milliseconds := 120000
    );
  $schedule$);
end;
$$;
