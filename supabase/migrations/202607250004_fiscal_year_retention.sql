alter table public.revenue_events
  add column if not exists retention_expires_at date;

-- Stores can have a non-calendar financial year. Eight years from the
-- transaction date safely covers the statutory seven years from the end of
-- any twelve-month accounting year without requiring each merchant's fiscal
-- year configuration.
update public.orders
set retention_expires_at = ((created_at at time zone 'Europe/Tallinn')::date + interval '8 years')::date;

update public.revenue_events
set retention_expires_at = ((occurred_at at time zone 'Europe/Tallinn')::date + interval '8 years')::date
where retention_expires_at is null;

alter table public.orders
  alter column retention_expires_at set default ((now() at time zone 'Europe/Tallinn')::date + interval '8 years')::date;

alter table public.revenue_events
  alter column retention_expires_at set default ((now() at time zone 'Europe/Tallinn')::date + interval '8 years')::date,
  alter column retention_expires_at set not null;

comment on column public.orders.retention_expires_at is
  'The first deletion date: eight years after the order date, covering seven years from the end of any twelve-month accounting year.';
comment on column public.revenue_events.retention_expires_at is
  'The first deletion date: eight years after the event date, covering seven years from the end of Animaator OÜ''s accounting year.';

create index if not exists revenue_events_retention_expires_at_idx
  on public.revenue_events(retention_expires_at);

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
  where retention_expires_at <= (reference_time at time zone 'Europe/Tallinn')::date
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
