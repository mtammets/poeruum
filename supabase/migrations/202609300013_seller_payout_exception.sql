-- A separately attributed operator exception for an existing seller is not a seller declaration.
-- No exceptions are granted by this migration. Ordinary sellers still self-declare.
create table if not exists public.seller_payout_exceptions (
  store_id uuid primary key references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null,
  stripe_mode text not null check (stripe_mode in ('test','live')),
  identity jsonb not null,
  bank jsonb not null check (nullif(bank->>'id','') is not null and bank->>'country'='EE' and bank->>'currency'='eur'),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  revoked_at timestamptz
);
alter table public.seller_payout_exceptions enable row level security;
revoke all on public.seller_payout_exceptions from public,anon,authenticated;
grant select,insert,update,delete on public.seller_payout_exceptions to service_role;
comment on table public.seller_payout_exceptions is 'Private, explicit operator exceptions. Not seller attestations or proof of bank tax status. Refresh the store settings in the same transaction after granting or revoking.';

create or replace function public.project_seller_payout_exception()
returns trigger language plpgsql security definer set search_path='' as $$
declare exception_active boolean;
begin
  -- Never trust the client projection, even on INSERT or service-role writes.
  new.settings:=coalesce(new.settings,'{}'::jsonb)-'entrepreneurPayoutAdminException';
  update public.seller_payout_exceptions e set revoked_at=now()
    where e.store_id=new.id and e.revoked_at is null and (
      e.owner_id is distinct from new.owner_id or e.account_id is distinct from new.stripe_account_id
      or e.stripe_mode is distinct from new.stripe_account_mode
      or e.identity is distinct from public.seller_identity_key(new.settings)
      or not exists (select 1 from public.store_payment_checks c where c.store_id=new.id and c.bank=e.bank)
    );
  select exists(select 1 from public.seller_payout_exceptions e
    where e.store_id=new.id and e.revoked_at is null) into exception_active;
  if exception_active then new.settings:=new.settings||'{"entrepreneurPayoutAdminException":true}'::jsonb; end if;
  if tg_op='UPDATE' and old.settings->'entrepreneurPayoutAdminException'='true'::jsonb
    and not exception_active and new.settings->'entrepreneurPayoutConfirmed' is distinct from 'true'::jsonb
    and new.stripe_account_id is not null then new.payment_status:='pending'; end if;
  return new;
end;
$$;
revoke all on function public.project_seller_payout_exception() from public,anon,authenticated;
-- Run before the existing identity/payment triggers, including on autosaves omitting this field.
drop trigger if exists stores_00_project_payout_exception on public.stores;
create trigger stores_00_project_payout_exception before insert or update on public.stores
  for each row execute function public.project_seller_payout_exception();

create or replace function public.seller_payout_accepted(settings_value jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(settings_value->'entrepreneurPayoutConfirmed'='true'::jsonb,false)
    or coalesce(settings_value->'entrepreneurPayoutAdminException'='true'::jsonb,false);
$$;

create or replace function public.seller_details_complete(settings_value jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(
    coalesce(settings_value->>'sellerType','company') in ('company','entrepreneur')
    and length(btrim(coalesce(settings_value->>'businessAddress',''))) between 1 and 400
    and length(btrim(coalesce(settings_value->>'contactEmail',''))) between 1 and 254
    and btrim(settings_value->>'contactEmail') ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and case when settings_value->>'sellerType'='entrepreneur' then
      length(btrim(coalesce(settings_value->>'sellerFirstName',''))) between 1 and 100
      and length(btrim(coalesce(settings_value->>'sellerLastName',''))) between 1 and 100
      and public.seller_payout_accepted(settings_value)
      and coalesce(settings_value->>'vatRegistered','false')='false'
      and btrim(coalesce(settings_value->>'vatNumber',''))=''
    else
      length(btrim(coalesce(settings_value->>'businessName',''))) between 1 and 200
      and btrim(coalesce(settings_value->>'registryCode','')) ~ '^[0-9]{8}$'
      and (coalesce(settings_value->>'vatRegistered','false')='false'
        or upper(btrim(coalesce(settings_value->>'vatNumber',''))) ~ '^EE[0-9]{9}$')
    end, false);
$$;

create or replace function public.sync_store_payment_check(target_store_id uuid, account_value text, mode_value text,
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
  -- A changed bank revokes the scoped exception before readiness is calculated.
  update public.stores set settings=settings where id=target_store_id returning * into target;
  ready:=ready_value and error_value is null and (coalesce(target.settings->>'sellerType','company')<>'entrepreneur' or (public.seller_details_complete(target.settings)
    and nullif(bank_value->>'id','') is not null and bank_value->>'country'='EE' and bank_value->>'currency'='eur'));
  ready:=coalesce(ready,false);
  update public.stores set payment_status=case when ready then 'connected' else 'pending' end where id=target_store_id;
  return ready;
end;
$$;
revoke all on function public.sync_store_payment_check(uuid,text,text,jsonb,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.sync_store_payment_check(uuid,text,text,jsonb,jsonb,text,boolean) to service_role;

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

  if target_store.settings->>'sellerType'='entrepreneur' then
    if not public.seller_payout_accepted(target_store.settings) then
      raise exception 'Kinnita enda aktiivse ettevõtluskonto kasutamine müüja andmetes.';
    end if;
    if not exists (
      select 1 from public.store_payment_checks c where c.store_id=target_store.id
        and c.account_id=target_store.stripe_account_id and c.stripe_mode=target_store.stripe_account_mode
        and c.identity=public.seller_identity_key(target_store.settings) and c.identity_error is null and c.stripe_ready
        and nullif(c.bank->>'id','') is not null and c.bank->>'country'='EE' and c.bank->>'currency'='eur'
    ) then raise exception 'Enne avaldamist lõpeta Stripe’i maksete seadistamine.'; end if;
  end if;

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

create or replace function public.admin_payment_reviews()
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
        c.bank,c.identity_error,c.checked_at,c.stripe_ready,s.payment_status,
        coalesce(s.settings->'entrepreneurPayoutConfirmed'='true'::jsonb,false) as seller_confirmed,
        coalesce(s.settings->'entrepreneurPayoutAdminException'='true'::jsonb,false) as admin_exception
      from public.stores s left join public.store_payment_checks c on c.store_id=s.id
      where s.stripe_account_id is not null and (s.settings->>'sellerType'='entrepreneur' or c.identity_error is not null)
      order by (c.identity_error is not null) desc,s.created_at limit 200) q),'[]'::jsonb));
end;
$$;
