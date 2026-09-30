-- Payment truth and recovery are separate: a refunded customer stays refunded
-- even if recovering the seller transfer needs operator intervention.
alter table public.stripe_order_settlements add column funding_retry_count integer not null default 0 check(funding_retry_count>=0);

alter table public.orders
  add column stripe_payment_issue text check (stripe_payment_issue in ('partial_refund','dispute','funds_required','review')),
  add column stripe_refunded_amount_cents integer not null default 0 check (stripe_refunded_amount_cents >= 0),
  add column stripe_dispute_id text,
  add column stripe_dispute_status text;

create function public.observe_stripe_order_payment(target_order_id uuid, mode_value text,
  refunded_cents integer, full_refund_id text default null, dispute_id_value text default null, dispute_status_value text default null, refund_review_value text default null)
returns void language plpgsql security definer set search_path='' as $$
declare payment public.orders%rowtype; job public.stripe_order_settlements%rowtype; issue text; full_refund boolean;
begin
  select * into payment from public.orders where id=target_order_id for update;
  if not found or payment.stripe_mode is distinct from mode_value or payment.payment_status not in ('paid','refunded') then
    raise exception 'PAYMENT_OBSERVATION_MISMATCH';
  end if;
  if refunded_cents < 0 or refunded_cents > round(payment.total*100)::integer then raise exception 'INVALID_REFUND_AMOUNT'; end if;
  -- Refunds are monotonic; delayed webhook deliveries cannot undo a refund.
  refunded_cents := greatest(refunded_cents,payment.stripe_refunded_amount_cents);
  full_refund := refunded_cents=round(payment.total*100)::integer;
  issue := payment.stripe_payment_issue;
  if refund_review_value='partial_refund' and issue is distinct from 'dispute' then issue:='partial_refund'; end if;
  if dispute_id_value is not null then
    if dispute_status_value in ('won','warning_closed') then
      if issue='dispute' then issue:=null; end if;
    else issue:='dispute'; end if;
  end if;
  if full_refund and issue='partial_refund' then issue:=null; end if;
  if refunded_cents>0 and not full_refund and issue is distinct from 'dispute' then issue:='partial_refund'; end if;
  update public.orders set stripe_refunded_amount_cents=refunded_cents,
    stripe_payment_issue=issue,
    stripe_dispute_id=coalesce(dispute_id_value,stripe_dispute_id),
    stripe_dispute_status=coalesce(dispute_status_value,stripe_dispute_status),
    stripe_refund_id=coalesce(full_refund_id,stripe_refund_id),
    stripe_refund_status=case when full_refund then 'succeeded' else stripe_refund_status end,
    payment_status=case when full_refund then 'refunded' else payment_status end,
    status=case when full_refund then 'refunded' else status end
    where id=target_order_id;
  insert into public.stripe_order_settlements(order_id,stripe_mode) values(target_order_id,mode_value) on conflict do nothing;
  select * into job from public.stripe_order_settlements where order_id=target_order_id for update;
  if full_refund then
    update public.stripe_order_settlements set refund_requested_at=coalesce(refund_requested_at,now()),
      stripe_refund_id=coalesce(full_refund_id,stripe_refund_id),
      status=case when lease_expires_at>now() or status='refunded' or issue in ('dispute','funds_required') then status else 'pending' end,
      next_attempt_at=now() where order_id=target_order_id;
  elsif issue in ('partial_refund','dispute') then
    update public.stripe_order_settlements set status=case when lease_expires_at>now() then status else 'needs_review' end,
      last_error=case when issue='dispute' then 'Stripe’i makse on vaidlustatud. Ava vaidlus Stripe’is.' else 'Stripe’is on tehtud osaline tagastus. Kontrolli arvestust Stripe’is.' end
      where order_id=target_order_id;
  elsif payment.stripe_payment_issue='dispute' and issue is null and job.status='needs_review' then
    update public.stripe_order_settlements set status='pending',next_attempt_at=now() where order_id=target_order_id;
  end if;
end;
$$;
revoke all on function public.observe_stripe_order_payment(uuid,text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.observe_stripe_order_payment(uuid,text,integer,text,text,text,text) to service_role;

create or replace function public.finish_stripe_order_settlement(
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
  if payment.stripe_payment_issue in ('partial_refund','dispute') then outcome_value := 'needs_review'; end if;
  if outcome_value = 'completed' and job.refund_requested_at is not null then outcome_value := 'retry'; end if;
  if outcome_value = 'completed' and payment.stripe_transfer_id is null then
    raise exception 'TRANSFER_REFERENCE_REQUIRED';
  end if;
  if outcome_value in ('refund_pending', 'refunded') then
    if job.refund_requested_at is null then raise exception 'REFUND_NOT_REQUESTED'; end if;
    if refund_id_value is null or refund_id_value not like 're\_%' escape '\' then raise exception 'REFUND_REFERENCE_REQUIRED'; end if;
    if job.stripe_refund_id is not null and job.stripe_refund_id <> refund_id_value then raise exception 'ORDER_REFUND_MISMATCH'; end if;
    update public.orders set stripe_refund_id = refund_id_value,
      stripe_payment_issue = case when outcome_value='refunded' then null else stripe_payment_issue end,
      stripe_refunded_amount_cents = case when outcome_value='refunded' then round(total*100)::integer else stripe_refunded_amount_cents end,
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
  elsif outcome_value = 'needs_review' then
    update public.orders set
      stripe_payment_issue=coalesce(stripe_payment_issue,case when error_value like 'FUNDS_REQUIRED:%' then 'funds_required' when error_value like 'DISPUTE:%' then 'dispute' else 'review' end),
      stripe_refund_status=case when payment_status='refunded' then 'succeeded' when job.refund_requested_at is not null then 'failed' else stripe_refund_status end
      where id=target_order_id;
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

create or replace function public.check_stripe_order_settlement_lease(target_order_id uuid, token_value uuid)
returns public.stripe_order_settlements
language plpgsql security definer set search_path = '' as $$
declare job public.stripe_order_settlements%rowtype;
begin
  select * into job from public.stripe_order_settlements where order_id = target_order_id;
  if not found or token_value is null or job.lease_token is distinct from token_value
    or job.lease_expires_at is null or job.lease_expires_at <= now() then raise exception 'SETTLEMENT_LEASE_LOST'; end if;
  if exists(select 1 from public.orders where id=target_order_id and stripe_payment_issue in ('partial_refund','dispute')) then raise exception 'PAYMENT_REVIEW_REQUIRED'; end if;
  return job;
end;
$$;

create function public.retry_funded_stripe_refund(target_order_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.orders where id=target_order_id and stripe_payment_issue='funds_required' for update;
  if not found then raise exception 'REFUND_NOT_AWAITING_FUNDS'; end if;
  perform 1 from public.stripe_order_settlements where order_id=target_order_id and status='needs_review' and refund_requested_at is not null
    and (last_error like 'FUNDS_REQUIRED:reversal:%' or last_error like 'FUNDS_REQUIRED:refund:%')
    and (lease_expires_at is null or lease_expires_at<=now()) for update;
  if not found then raise exception 'SETTLEMENT_BUSY'; end if;
  update public.orders set stripe_payment_issue=null,
    stripe_refund_status=case when payment_status='refunded' then 'succeeded' else 'requested' end where id=target_order_id;
  update public.stripe_order_settlements set status='pending',next_attempt_at=now(),
    funding_retry_count=funding_retry_count+1,
    refund_started_at=case when last_error like 'FUNDS_REQUIRED:refund:%' then now() else refund_started_at end,
    last_error=null where order_id=target_order_id;
end;
$$;
revoke all on function public.retry_funded_stripe_refund(uuid) from public,anon,authenticated;
grant execute on function public.retry_funded_stripe_refund(uuid) to service_role;

-- Contains private payout-account evidence. Nothing is placed in public settings.
create table public.store_payment_checks (
  store_id uuid primary key references public.stores(id) on delete cascade,
  account_id text not null,
  stripe_mode text not null check(stripe_mode in ('test','live')),
  identity jsonb not null,
  identity_error text,
  bank jsonb not null default '{}'::jsonb,
  stripe_ready boolean not null default false,
  checked_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  evidence text
);
alter table public.store_payment_checks enable row level security;
revoke all on public.store_payment_checks from public,anon,authenticated;
grant all on public.store_payment_checks to service_role;

create function public.seller_identity_key(settings_value jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select case when settings_value->>'sellerType'='entrepreneur' then
    jsonb_build_array('entrepreneur',lower(btrim(settings_value->>'sellerFirstName')),lower(btrim(settings_value->>'sellerLastName')))
  else jsonb_build_array('company',lower(btrim(settings_value->>'businessName')),btrim(settings_value->>'registryCode')) end;
$$;
revoke all on function public.seller_identity_key(jsonb) from public,anon,authenticated;
grant execute on function public.seller_identity_key(jsonb) to service_role;

create function public.invalidate_store_payment_check()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.stripe_account_id is distinct from new.stripe_account_id
    or old.stripe_account_mode is distinct from new.stripe_account_mode
    or public.seller_identity_key(old.settings) is distinct from public.seller_identity_key(new.settings) then
    delete from public.store_payment_checks where store_id=new.id;
    if old.stripe_account_id is not null and new.stripe_account_id is not null then new.payment_status:='pending'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.invalidate_store_payment_check() from public,anon,authenticated;
create trigger stores_invalidate_payment_check before update of settings,stripe_account_id,stripe_account_mode on public.stores
  for each row execute function public.invalidate_store_payment_check();

create function public.sync_store_payment_check(target_store_id uuid, account_value text, mode_value text,
  settings_value jsonb, bank_value jsonb, error_value text, ready_value boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare target public.stores%rowtype; previous public.store_payment_checks%rowtype; approved boolean; ready boolean;
begin
  select * into target from public.stores where id=target_store_id for update;
  if not found or target.stripe_account_id is distinct from account_value or target.stripe_account_mode is distinct from mode_value
    or public.seller_identity_key(target.settings) is distinct from public.seller_identity_key(settings_value) then raise exception 'SELLER_CHANGED'; end if;
  select * into previous from public.store_payment_checks where store_id=target_store_id for update;
  approved := coalesce(previous.verified_at is not null and previous.account_id=account_value and previous.stripe_mode=mode_value
    and previous.identity=public.seller_identity_key(settings_value) and previous.bank=bank_value and error_value is null,false);
  insert into public.store_payment_checks(store_id,account_id,stripe_mode,identity,bank,identity_error,stripe_ready)
    values(target_store_id,account_value,mode_value,public.seller_identity_key(settings_value),bank_value,error_value,ready_value)
    on conflict(store_id) do update set account_id=excluded.account_id,stripe_mode=excluded.stripe_mode,identity=excluded.identity,
      bank=excluded.bank,identity_error=excluded.identity_error,stripe_ready=excluded.stripe_ready,checked_at=now(),
      verified_at=case when approved then store_payment_checks.verified_at end,
      verified_by=case when approved then store_payment_checks.verified_by end,
      evidence=case when approved then store_payment_checks.evidence end;
  ready:=ready_value and error_value is null and (coalesce(target.settings->>'sellerType','company')<>'entrepreneur' or approved);
  update public.stores set payment_status=case when ready then 'connected' else 'pending' end where id=target_store_id;
  return ready;
end;
$$;
revoke all on function public.sync_store_payment_check(uuid,text,text,jsonb,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.sync_store_payment_check(uuid,text,text,jsonb,jsonb,text,boolean) to service_role;

create function public.approve_entrepreneur_payout(target_store_id uuid, bank_id_value text, evidence_value text, admin_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target public.stores%rowtype; verification public.store_payment_checks%rowtype;
begin
  if not exists(select 1 from auth.users where id=admin_id and raw_app_meta_data->>'role'='admin') then raise exception 'ADMIN_REQUIRED'; end if;
  select * into target from public.stores where id=target_store_id for update;
  select * into verification from public.store_payment_checks where store_id=target_store_id for update;
  if not found or target.settings->>'sellerType' is distinct from 'entrepreneur'
    or verification.account_id is distinct from target.stripe_account_id or verification.stripe_mode is distinct from target.stripe_account_mode
    or verification.identity is distinct from public.seller_identity_key(target.settings)
    or verification.bank->>'id' is distinct from bank_id_value or nullif(bank_id_value,'') is null
    or verification.bank->>'country' is distinct from 'EE' or verification.bank->>'currency' is distinct from 'eur'
    or verification.identity_error is not null or not verification.stripe_ready
    or verification.checked_at < now()-interval '5 minutes'
    or coalesce(length(btrim(evidence_value)),0)<20 or length(evidence_value)>2000 then raise exception 'PAYOUT_VERIFICATION_REQUIRED'; end if;
  update public.store_payment_checks set verified_at=now(),verified_by=admin_id,evidence=evidence_value where store_id=target_store_id;
  update public.stores set payment_status='connected' where id=target_store_id;
end;
$$;
revoke all on function public.approve_entrepreneur_payout(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.approve_entrepreneur_payout(uuid,text,text,uuid) to service_role;

create function public.admin_payment_reviews()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('orders',coalesce((select jsonb_agg(row_to_json(q)) from (
    select o.id,o.order_number,s.name as store_name,o.stripe_mode,o.stripe_payment_intent_id,o.stripe_payment_issue,
      o.stripe_dispute_id,o.stripe_dispute_status,o.stripe_refunded_amount_cents,j.status,j.last_error,o.payment_status
    from public.orders o join public.stores s on s.id=o.store_id left join public.stripe_order_settlements j on j.order_id=o.id
    where o.stripe_payment_issue is not null or j.status='needs_review' order by o.updated_at desc limit 200) q),'[]'::jsonb),
    'sellers',coalesce((select jsonb_agg(row_to_json(q)) from (
      select s.id,s.name,s.settings->>'businessName' as seller_name,s.stripe_account_id,s.stripe_account_mode,
        c.bank,c.identity_error,c.verified_at,c.checked_at
      from public.stores s left join public.store_payment_checks c on c.store_id=s.id
      where s.settings->>'sellerType'='entrepreneur' and s.stripe_account_id is not null
      order by c.verified_at nulls first,s.created_at limit 200) q),'[]'::jsonb));
end;
$$;
revoke all on function public.admin_payment_reviews() from public,anon;
grant execute on function public.admin_payment_reviews() to authenticated;

create or replace function public.publish_store(target_store_id uuid)
returns public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_store public.stores%rowtype;
  target_settings jsonb;
begin
  if current_user_id is null then
    raise exception 'Poe avaldamiseks logi sisse.' using errcode = '42501';
  end if;

  select store.*
  into target_store
  from public.stores as store
  where store.id = target_store_id
    and store.owner_id = current_user_id
  for update;

  if target_store.id is null then
    raise exception 'Poodi ei leitud või sul puudub selle muutmise õigus.' using errcode = '42501';
  end if;

  perform public.require_merchant_email(current_user_id);

  if target_store.settings->>'sellerType'='entrepreneur' and not exists (
    select 1 from public.store_payment_checks where store_id=target_store.id and verified_at is not null
      and account_id=target_store.stripe_account_id and stripe_mode=target_store.stripe_account_mode
      and identity=public.seller_identity_key(target_store.settings) and identity_error is null and stripe_ready
  ) then raise exception 'Enne avaldamist peab Poeruumi tugi kontrollima ettevõtluskontot.'; end if;

  if target_store.is_published then
    return target_store;
  end if;

  target_settings := coalesce(target_store.settings, '{}'::jsonb);

  if not public.seller_details_complete(target_settings) then
    raise exception 'Enne avaldamist lisa täielikud müüja andmed.';
  end if;

  if target_store.payment_provider <> 'stripe'
    or target_store.payment_status <> 'connected'
    or target_store.stripe_account_id is null
    or not target_store.stripe_account_charges_enabled
    or not target_store.stripe_account_payouts_enabled then
    raise exception 'Enne avaldamist ühenda Stripe’i maksed.';
  end if;

  if coalesce(cardinality(target_store.shipping), 0) = 0 then
    raise exception 'Enne avaldamist vali vähemalt üks tarneviis.';
  end if;

  if not exists (
    select 1
    from public.products as product
    where product.store_id = target_store.id
  ) then
    raise exception 'Enne avaldamist lisa vähemalt üks toode.';
  end if;

  if target_store.pricing_plan = 'fixed'
    and coalesce(target_store.stripe_subscription_status, '') not in ('active', 'trialing') then
    raise exception 'Kindla paketi tellimus peab enne avaldamist olema aktiivne.';
  end if;

  update public.stores
  set is_published = true,
      settings = jsonb_set(target_settings, '{onboardingStep}', '"complete"'::jsonb, true)
  where id = target_store.id
  returning * into target_store;

  return target_store;
end;
$$;
