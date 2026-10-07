-- Keep the shipping contact on the merchant-readable order, without exposing
-- the private Stripe request. Older orders may legitimately have no phone.
alter table public.orders add column customer_phone text;

-- Use the original durable request, including for already-paid orders. Never
-- restore contact details for deleted merchants or overwrite an existing number.
update public.orders as orders
set customer_phone = nullif(btrim(attempt.payload #>> '{metadata,customer_phone}'), '')
from public.stripe_checkout_attempts as attempt, public.stores as store
where attempt.order_id = orders.id and store.id = orders.store_id
  and store.owner_id is not null and store.deleted_at is null
  and orders.customer_phone is null
  and nullif(btrim(attempt.payload #>> '{metadata,customer_phone}'), '') is not null;

-- Save the number atomically with the first outbound request. A checkout retry
-- must keep the original request and its contact details.
create or replace function public.prepare_stripe_checkout(target_order_id uuid, payload_value jsonb)
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
  update public.orders set stripe_checkout_started_at = attempt.started_at,
    customer_phone = nullif(btrim(attempt.payload #>> '{metadata,customer_phone}'), '')
  where id = target_order_id;
  return attempt;
end;
$$;

revoke all on function public.prepare_stripe_checkout(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.prepare_stripe_checkout(uuid,jsonb) to service_role;

-- Phone numbers follow the same account-deletion policy as names and emails.
create or replace function public.handle_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email is not null then
    delete from public.email_deliveries
    where lower(recipient_email) = lower(old.email::text);
  end if;

  update public.orders
  set
    customer_phone = null,
    customer_name = 'Kustutatud klient',
    customer_email = 'deleted+' || replace(id::text, '-', '') || '@invalid.poeruum.ee',
    delivery = 'Tarneandmed eemaldatud konto kustutamisel'
  where store_id in (select id from public.stores where owner_id = old.id);

  delete from public.products
  where store_id in (select id from public.stores where owner_id = old.id);

  delete from public.custom_domains
  where store_id in (select id from public.stores where owner_id = old.id);

  delete from public.stores as store
  where store.owner_id = old.id
    and not exists (select 1 from public.orders as orders where orders.store_id = store.id)
    and not exists (select 1 from public.revenue_events as event where event.store_id = store.id);

  update public.stores
  set
    owner_id = null,
    name = 'Kustutatud pood',
    slug = 'deleted-' || id::text,
    is_published = false,
    payment_provider = 'stripe',
    payment_status = 'idle',
    pricing_plan = 'flexible',
    trial_started_at = null,
    shipping = '{}'::text[],
    settings = '{}'::jsonb,
    stripe_account_id = null,
    stripe_account_charges_enabled = false,
    stripe_account_payouts_enabled = false,
    stripe_account_requirements_due_count = 0,
    stripe_account_requirements_past_due = false,
    stripe_account_requirements_deadline = null,
    stripe_account_requirements_pending_verification = false,
    stripe_account_requirements_disabled_reason = null,
    stripe_account_requirements_updated_at = null,
    stripe_customer_id = null,
    stripe_subscription_id = null,
    stripe_subscription_status = null,
    stripe_account_mode = null,
    stripe_billing_mode = null,
    deleted_at = now()
  where owner_id = old.id;

  return old;
end;
$$;

revoke all on function public.handle_account_deletion() from public, anon, authenticated;
