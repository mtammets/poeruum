alter table public.orders
  add column if not exists retention_expires_at date,
  add column if not exists retention_hold_until timestamptz;

alter table public.revenue_events
  add column if not exists retention_hold_until timestamptz;

alter table public.stores
  alter column owner_id drop not null;

update public.orders
set retention_expires_at = make_date(
  extract(year from created_at at time zone 'Europe/Tallinn')::integer + 8,
  1,
  1
)
where retention_expires_at is null;

alter table public.orders
  alter column retention_expires_at set default make_date(
    extract(year from now() at time zone 'Europe/Tallinn')::integer + 8,
    1,
    1
  ),
  alter column retention_expires_at set not null;

comment on column public.orders.retention_expires_at is
  'The first date on which the order record may be deleted: seven years after the end of its accounting year.';
comment on column public.orders.retention_hold_until is
  'Optional documented legal hold. Retention cleanup skips the order until this instant.';
comment on column public.revenue_events.retention_hold_until is
  'Optional documented legal hold. Retention cleanup skips the event until this instant.';

create index if not exists orders_retention_expires_at_idx
  on public.orders(retention_expires_at);

create or replace function public.apply_data_retention(reference_time timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_orders integer := 0;
  deleted_revenue_events integer := 0;
  deleted_email_deliveries integer := 0;
  deleted_stripe_webhooks integer := 0;
  deleted_resend_webhooks integer := 0;
  deleted_cleanup_records integer := 0;
  deleted_presence_sessions integer := 0;
  deleted_tombstone_stores integer := 0;
begin
  delete from public.orders
  where retention_expires_at <= (reference_time at time zone 'Europe/Tallinn')::date
    and (retention_hold_until is null or retention_hold_until <= reference_time);
  get diagnostics deleted_orders = row_count;

  delete from public.revenue_events
  where occurred_at < date_trunc('year', reference_time at time zone 'Europe/Tallinn') - interval '7 years'
    and (retention_hold_until is null or retention_hold_until <= reference_time);
  get diagnostics deleted_revenue_events = row_count;

  delete from public.email_deliveries
  where sent_at < reference_time - interval '90 days';
  get diagnostics deleted_email_deliveries = row_count;

  delete from public.stripe_webhook_events
  where received_at < reference_time - interval '90 days';
  get diagnostics deleted_stripe_webhooks = row_count;

  delete from public.resend_webhook_events
  where processed_at < reference_time - interval '30 days';
  get diagnostics deleted_resend_webhooks = row_count;

  delete from public.external_resource_cleanup
  where status in ('completed', 'skipped')
    and updated_at < reference_time - interval '90 days';
  get diagnostics deleted_cleanup_records = row_count;

  delete from public.user_presence_sessions
  where last_seen_at < reference_time - interval '1 day';
  get diagnostics deleted_presence_sessions = row_count;

  delete from public.stores as store
  where store.owner_id is null
    and store.deleted_at is not null
    and not exists (select 1 from public.orders as orders where orders.store_id = store.id)
    and not exists (select 1 from public.revenue_events as event where event.store_id = store.id);
  get diagnostics deleted_tombstone_stores = row_count;

  return jsonb_build_object(
    'orders', deleted_orders,
    'revenue_events', deleted_revenue_events,
    'email_deliveries', deleted_email_deliveries,
    'stripe_webhooks', deleted_stripe_webhooks,
    'resend_webhooks', deleted_resend_webhooks,
    'cleanup_records', deleted_cleanup_records,
    'presence_sessions', deleted_presence_sessions,
    'tombstone_stores', deleted_tombstone_stores
  );
end;
$$;

revoke all on function public.apply_data_retention(timestamptz) from public, anon, authenticated;
grant execute on function public.apply_data_retention(timestamptz) to service_role;

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

  -- The merchant must export any records they still need before closing the
  -- account. Customer contact and delivery data is no longer needed by Poeruum,
  -- while the non-identifying accounting record remains until its fixed expiry.
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
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'poeruum-data-retention';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'poeruum-data-retention',
    '15 2 * * *',
    $schedule$
      select net.http_post(
        url := replace(
          (select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_reminders_url' limit 1),
          '/onboarding-reminders',
          '/data-retention-reaper'
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_cron_secret' limit 1)
        ),
        body := '{}'::jsonb
      );
    $schedule$
  );
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'owner_id'
      and is_nullable <> 'YES'
  ) then
    raise exception 'stores.owner_id must accept NULL for retained accounting tombstones';
  end if;

  if has_function_privilege('anon', 'public.apply_data_retention(timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.apply_data_retention(timestamptz)', 'EXECUTE')
  then
    raise exception 'Data retention maintenance must not be callable by application roles';
  end if;
end
$$;
