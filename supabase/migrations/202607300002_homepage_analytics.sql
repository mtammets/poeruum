-- Privacy-first first-party analytics for the Poeruum marketing homepage.
-- A random session identifier lives only in the open page's memory. The event
-- stream contains no account/user identifier, full referrer URL or IP address.

create table public.homepage_analytics_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null check (
    char_length(session_id) between 16 and 64
    and session_id ~ '^[a-zA-Z0-9-]+$'
  ),
  event_name text not null check (event_name in (
    'page_view',
    'section_view',
    'signup_start',
    'demo_open',
    'faq_open',
    'account_created'
  )),
  event_label text not null default '' check (char_length(event_label) <= 80),
  audience text not null default 'anonymous' check (audience in ('anonymous', 'merchant')),
  referrer_host text not null default '' check (char_length(referrer_host) <= 120),
  utm_source text not null default '' check (char_length(utm_source) <= 80),
  utm_medium text not null default '' check (char_length(utm_medium) <= 80),
  utm_campaign text not null default '' check (char_length(utm_campaign) <= 100),
  device_type text not null check (device_type in ('mobile', 'tablet', 'desktop')),
  occurred_at timestamptz not null default now(),
  unique (session_id, event_name, event_label)
);

create index homepage_analytics_events_occurred_at_idx
  on public.homepage_analytics_events(occurred_at desc);
create index homepage_analytics_events_name_occurred_at_idx
  on public.homepage_analytics_events(event_name, occurred_at desc);

alter table public.homepage_analytics_events enable row level security;
revoke all on table public.homepage_analytics_events from public, anon, authenticated;
grant select, insert, delete on table public.homepage_analytics_events to service_role;

comment on table public.homepage_analytics_events is
  'Anonymous marketing-homepage events. Raw rows are retained for 90 days.';
comment on column public.homepage_analytics_events.session_id is
  'Random per-page-load identifier held only in browser memory; never linked to auth.users.';
comment on column public.homepage_analytics_events.referrer_host is
  'Hostname only. Referrer path, query parameters and fragment are discarded in the browser.';

create or replace function public.admin_homepage_analytics(requested_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  range_start timestamptz;
  range_start_date date;
  range_end_date date := (now() at time zone 'Europe/Tallinn')::date;
  result jsonb;
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if requested_days is null or requested_days not in (7, 30, 90) then
    raise exception 'Analytics range must be 7, 30 or 90 days';
  end if;

  range_start_date := range_end_date - (requested_days - 1);
  range_start := range_start_date::timestamp at time zone 'Europe/Tallinn';

  with
  range_events as materialized (
    select event.*
    from public.homepage_analytics_events as event
    where event.occurred_at >= range_start
  ),
  cohort as materialized (
    select
      users.id as user_id,
      users.created_at,
      store.id as store_id,
      coalesce(store.payment_status = 'connected', false) as has_payments,
      coalesce(store.is_published, false) as is_published
    from auth.users as users
    left join lateral (
      select candidate.id, candidate.payment_status, candidate.is_published
      from public.stores as candidate
      where candidate.owner_id = users.id
      order by candidate.created_at
      limit 1
    ) as store on true
    where users.created_at >= range_start
      and coalesce(users.raw_app_meta_data ->> 'role', '') <> 'admin'
  ),
  days as (
    select generate_series(range_start_date, range_end_date, interval '1 day')::date as day
  ),
  daily_events as (
    select
      (event.occurred_at at time zone 'Europe/Tallinn')::date as day,
      count(distinct event.session_id) filter (where event.event_name = 'page_view')::integer as sessions,
      count(distinct event.session_id) filter (where event.event_name = 'signup_start')::integer as signup_starts
    from range_events as event
    group by 1
  ),
  daily_accounts as (
    select
      (cohort.created_at at time zone 'Europe/Tallinn')::date as day,
      count(*)::integer as accounts_created
    from cohort
    group by 1
  ),
  first_page_views as (
    select distinct on (event.session_id)
      event.session_id,
      event.referrer_host,
      event.utm_source,
      event.device_type
    from range_events as event
    where event.event_name = 'page_view'
    order by event.session_id, event.occurred_at
  ),
  source_rows as (
    select
      case
        when nullif(page_view_row.utm_source, '') is not null then page_view_row.utm_source
        when nullif(page_view_row.referrer_host, '') is not null then page_view_row.referrer_host
        else 'Otse'
      end as source,
      count(*)::integer as sessions
    from first_page_views as page_view_row
    group by 1
    order by sessions desc, source
    limit 8
  ),
  device_rows as (
    select page_view_row.device_type as device, count(*)::integer as sessions
    from first_page_views as page_view_row
    group by page_view_row.device_type
    order by sessions desc, device
  ),
  cta_rows as (
    select event.event_label as label, count(distinct event.session_id)::integer as sessions
    from range_events as event
    where event.event_name = 'signup_start'
    group by event.event_label
    order by sessions desc, label
  ),
  faq_rows as (
    select event.event_label as label, count(distinct event.session_id)::integer as sessions
    from range_events as event
    where event.event_name = 'faq_open'
    group by event.event_label
    order by sessions desc, label
    limit 8
  )
  select jsonb_build_object(
    'range_days', requested_days,
    'sessions', (
      select count(distinct event.session_id)::integer
      from range_events as event
      where event.event_name = 'page_view'
    ),
    'anonymous_sessions', (
      select count(distinct event.session_id)::integer
      from range_events as event
      where event.event_name = 'page_view' and event.audience = 'anonymous'
    ),
    'merchant_sessions', (
      select count(distinct event.session_id)::integer
      from range_events as event
      where event.event_name = 'page_view' and event.audience = 'merchant'
    ),
    'signup_starts', (
      select count(distinct event.session_id)::integer
      from range_events as event
      where event.event_name = 'signup_start'
    ),
    'tracked_accounts', (
      select count(distinct event.session_id)::integer
      from range_events as event
      where event.event_name = 'account_created'
    ),
    'demo_opens', (
      select count(distinct event.session_id)::integer
      from range_events as event
      where event.event_name = 'demo_open'
    ),
    'pricing_views', (
      select count(distinct event.session_id)::integer
      from range_events as event
      where event.event_name = 'section_view' and event.event_label = 'pricing'
    ),
    'accounts_created', (select count(*)::integer from cohort),
    'stores_started', (select count(*)::integer from cohort where store_id is not null),
    'payments_connected', (select count(*)::integer from cohort where has_payments),
    'stores_published', (select count(*)::integer from cohort where is_published),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', days.day,
        'sessions', coalesce(daily_events.sessions, 0),
        'signup_starts', coalesce(daily_events.signup_starts, 0),
        'accounts_created', coalesce(daily_accounts.accounts_created, 0)
      ) order by days.day)
      from days
      left join daily_events on daily_events.day = days.day
      left join daily_accounts on daily_accounts.day = days.day
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(to_jsonb(source_rows) order by source_rows.sessions desc, source_rows.source)
      from source_rows
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(to_jsonb(device_rows) order by device_rows.sessions desc, device_rows.device)
      from device_rows
    ), '[]'::jsonb),
    'ctas', coalesce((
      select jsonb_agg(to_jsonb(cta_rows) order by cta_rows.sessions desc, cta_rows.label)
      from cta_rows
    ), '[]'::jsonb),
    'faqs', coalesce((
      select jsonb_agg(to_jsonb(faq_rows) order by faq_rows.sessions desc, faq_rows.label)
      from faq_rows
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_homepage_analytics(integer) from public, anon;
grant execute on function public.admin_homepage_analytics(integer) to authenticated;

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
  deleted_homepage_analytics integer := 0;
  deleted_abandoned_drafts integer := 0;
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

  delete from public.homepage_analytics_events
  where occurred_at < reference_time - interval '90 days';
  get diagnostics deleted_homepage_analytics = row_count;

  with candidates as materialized (
    select store.id
    from public.stores as store
    join public.onboarding_journeys as journey
      on journey.store_id = store.id
      and journey.user_id = store.owner_id
    join auth.users as users on users.id = store.owner_id
    where store.owner_id is not null
      and store.deleted_at is null
      and not store.is_published
      and journey.completed_at is null
      and journey.step <> 'complete'
      and journey.cleanup_notice_sent_at <= reference_time - interval '7 days'
      and greatest(
        journey.last_activity_at,
        store.updated_at,
        coalesce(users.last_sign_in_at, '-infinity'::timestamptz)
      ) <= reference_time - interval '180 days'
      and coalesce(users.raw_app_meta_data ->> 'role', '') <> 'admin'
      and store.payment_status = 'idle'
      and store.pricing_plan = 'flexible'
      and store.trial_started_at is null
      and store.stripe_account_id is null
      and store.stripe_customer_id is null
      and store.stripe_subscription_id is null
      and not exists (select 1 from public.products product where product.store_id = store.id)
      and not exists (select 1 from public.orders orders where orders.store_id = store.id)
      and not exists (select 1 from public.revenue_events event where event.store_id = store.id)
      and not exists (select 1 from public.custom_domains domain where domain.store_id = store.id)
      and not exists (
        select 1
        from public.user_presence_sessions presence
        where presence.user_id = store.owner_id
          and presence.last_seen_at >= reference_time - interval '5 minutes'
      )
    order by journey.last_activity_at
    limit 100
    for update of store, journey, users skip locked
  ),
  queued as (
    insert into public.external_resource_cleanup (
      provider,
      resource_type,
      resource_id,
      status,
      last_error,
      completed_at
    )
    select
      'supabase_storage',
      'product_image_prefix',
      candidate.id::text,
      'pending',
      null,
      null
    from candidates as candidate
    on conflict (provider, resource_type, resource_id) do update
    set status = 'pending',
        last_error = null,
        completed_at = null,
        updated_at = now()
    returning resource_id
  )
  delete from public.stores as store
  using candidates as candidate
  where store.id = candidate.id
    and exists (
      select 1
      from queued
      where queued.resource_id = store.id::text
    );
  get diagnostics deleted_abandoned_drafts = row_count;

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
    'homepage_analytics', deleted_homepage_analytics,
    'abandoned_drafts', deleted_abandoned_drafts,
    'tombstone_stores', deleted_tombstone_stores
  );
end;
$$;

revoke all on function public.apply_data_retention(timestamptz) from public, anon, authenticated;
grant execute on function public.apply_data_retention(timestamptz) to service_role;
