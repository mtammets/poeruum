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
