alter table public.stores
  add column if not exists stripe_account_requirements_due_count integer not null default 0
    check (stripe_account_requirements_due_count >= 0),
  add column if not exists stripe_account_requirements_past_due boolean not null default false,
  add column if not exists stripe_account_requirements_deadline timestamptz,
  add column if not exists stripe_account_requirements_pending_verification boolean not null default false,
  add column if not exists stripe_account_requirements_disabled_reason text,
  add column if not exists stripe_account_requirements_updated_at timestamptz;

-- Store only a private, non-PII badge summary. Stripe's embedded notification
-- banner remains the source of truth for localized task and error details.

-- Stripe verification state is written only by service-role Edge Functions.
revoke update (
  stripe_account_requirements_due_count,
  stripe_account_requirements_past_due,
  stripe_account_requirements_deadline,
  stripe_account_requirements_pending_verification,
  stripe_account_requirements_disabled_reason,
  stripe_account_requirements_updated_at
) on table public.stores from authenticated;

comment on column public.stores.stripe_account_requirements_due_count is
  'Number of unique actionable fields across Stripe requirements and future_requirements.';
comment on column public.stores.stripe_account_requirements_deadline is
  'Earliest Stripe deadline for the connected account''s current or future requirements.';

-- Retained accounting tombstones must not keep obsolete Connect remediation state.
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

do $$
begin
  if has_column_privilege('authenticated', 'public.stores', 'stripe_account_requirements_due_count', 'UPDATE')
    or has_column_privilege('authenticated', 'public.stores', 'stripe_account_requirements_deadline', 'UPDATE')
    or has_column_privilege('authenticated', 'public.stores', 'stripe_account_requirements_disabled_reason', 'UPDATE') then
    raise exception 'ACCESS_ASSERTION_FAILED: authenticated can update Stripe requirement state';
  end if;
end;
$$;
