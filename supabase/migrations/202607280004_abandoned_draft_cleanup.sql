-- Remove only genuinely abandoned, empty drafts. A dedicated service notice
-- is sent after 173 days of inactivity and deletion becomes possible seven
-- days later. Any renewed activity clears the notice and restarts the clock.

alter table public.onboarding_journeys
  add column if not exists cleanup_notice_sent_at timestamptz;

alter table public.onboarding_journeys
  drop constraint if exists onboarding_journeys_claimed_reminder_check;
alter table public.onboarding_journeys
  add constraint onboarding_journeys_claimed_reminder_check
  check (claimed_reminder in (1, 2, 3));

drop index if exists public.onboarding_journeys_reminder_candidates_idx;
create index onboarding_journeys_reminder_candidates_idx
on public.onboarding_journeys(last_activity_at)
where completed_at is null
  and step <> 'complete'
  and (second_reminder_sent_at is null or cleanup_notice_sent_at is null);

create or replace function public.sync_store_onboarding_journey()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_step text;
begin
  if new.owner_id is null then return new; end if;
  if exists (
    select 1
    from auth.users users
    where users.id = new.owner_id
      and coalesce(users.raw_app_meta_data ->> 'role', '') = 'admin'
  ) then
    delete from public.onboarding_journeys where user_id = new.owner_id;
    return new;
  end if;

  next_step := case
    when new.is_published then 'complete'
    when new.settings ->> 'onboardingStep' in ('store', 'business', 'payments', 'shipping', 'product', 'publish')
      then new.settings ->> 'onboardingStep'
    else 'business'
  end;

  insert into public.onboarding_journeys (
    user_id,
    store_id,
    step,
    last_activity_at,
    completed_at
  )
  values (
    new.owner_id,
    new.id,
    next_step,
    now(),
    case when new.is_published then now() end
  )
  on conflict (user_id) do update
  set store_id = excluded.store_id,
      step = case when public.onboarding_journeys.completed_at is not null then 'complete' else excluded.step end,
      last_activity_at = case
        when public.onboarding_journeys.completed_at is null then now()
        else public.onboarding_journeys.last_activity_at
      end,
      completed_at = coalesce(public.onboarding_journeys.completed_at, excluded.completed_at),
      cleanup_notice_sent_at = case
        when public.onboarding_journeys.completed_at is null then null
        else public.onboarding_journeys.cleanup_notice_sent_at
      end,
      claimed_reminder = null,
      claim_expires_at = null,
      updated_at = now();
  return new;
end;
$$;

create or replace function public.touch_onboarding_activity(target_step text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if target_step not in ('store', 'business', 'payments', 'shipping', 'product', 'publish') then
    raise exception 'Invalid onboarding step';
  end if;
  if exists (
    select 1
    from auth.users users
    where users.id = current_user_id
      and coalesce(users.raw_app_meta_data ->> 'role', '') = 'admin'
  ) then
    delete from public.onboarding_journeys where user_id = current_user_id;
    return;
  end if;

  insert into public.onboarding_journeys (user_id, step, last_activity_at)
  values (current_user_id, target_step, now())
  on conflict (user_id) do update
  set step = case when public.onboarding_journeys.completed_at is null then excluded.step else 'complete' end,
      last_activity_at = case
        when public.onboarding_journeys.completed_at is null then now()
        else public.onboarding_journeys.last_activity_at
      end,
      cleanup_notice_sent_at = case
        when public.onboarding_journeys.completed_at is null then null
        else public.onboarding_journeys.cleanup_notice_sent_at
      end,
      claimed_reminder = null,
      claim_expires_at = null,
      updated_at = now();
end;
$$;

create or replace function public.cancel_draft_cleanup_on_sign_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_sign_in_at is distinct from old.last_sign_in_at then
    update public.onboarding_journeys
    set cleanup_notice_sent_at = null,
        claimed_reminder = null,
        claim_expires_at = null,
        last_activity_at = greatest(last_activity_at, new.last_sign_in_at),
        updated_at = now()
    where user_id = new.id
      and completed_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.cancel_draft_cleanup_on_sign_in() from public, anon, authenticated;

drop trigger if exists cancel_draft_cleanup_after_sign_in on auth.users;
create trigger cancel_draft_cleanup_after_sign_in
after update of last_sign_in_at on auth.users
for each row execute function public.cancel_draft_cleanup_on_sign_in();

-- Keep the original claim function intact during deployment. The versioned
-- function prevents an older Edge Function from interpreting cleanup notice
-- number 3 as an ordinary reminder.
create or replace function public.claim_onboarding_reminder_v2()
returns table (
  user_id uuid,
  email text,
  store_name text,
  onboarding_step text,
  reminder_number smallint,
  unsubscribe_token uuid,
  activity_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  next_reminder smallint;
begin
  select
    journey.*,
    users.email,
    coalesce(store.name, 'Sinu pood') as resolved_store_name,
    eligibility.cleanup_due
  into candidate
  from public.onboarding_journeys as journey
  join auth.users as users on users.id = journey.user_id
  left join public.stores as store on store.id = journey.store_id
  cross join lateral (
    select (
      journey.store_id is not null
      and journey.cleanup_notice_sent_at is null
      and greatest(
        journey.last_activity_at,
        coalesce(store.updated_at, '-infinity'::timestamptz),
        coalesce(users.last_sign_in_at, '-infinity'::timestamptz)
      ) <= now() - interval '173 days'
      and store.id is not null
      and not store.is_published
      and store.deleted_at is null
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
    ) as cleanup_due
  ) as eligibility
  where journey.completed_at is null
    and journey.step <> 'complete'
    and coalesce(users.raw_app_meta_data ->> 'role', '') <> 'admin'
    and users.email_confirmed_at is not null
    and users.email is not null
    and (journey.claim_expires_at is null or journey.claim_expires_at < now())
    and not exists (
      select 1
      from public.user_presence_sessions as presence
      where presence.user_id = journey.user_id
        and presence.last_seen_at >= now() - interval '5 minutes'
    )
    and (
      (
        journey.reminders_disabled_at is null
        and journey.last_activity_at <= now() - interval '3 hours'
        and (
          journey.first_reminder_sent_at is null
          or (
            journey.second_reminder_sent_at is null
            and journey.last_activity_at <= now() - interval '24 hours'
            and journey.first_reminder_sent_at <= now() - interval '18 hours'
          )
        )
      )
      or eligibility.cleanup_due
    )
  order by eligibility.cleanup_due desc nulls last, journey.last_activity_at
  limit 1
  for update of journey skip locked;

  if not found then return; end if;
  next_reminder := case
    when candidate.cleanup_due then 3
    when candidate.first_reminder_sent_at is null then 1
    else 2
  end;

  update public.onboarding_journeys
  set claimed_reminder = next_reminder,
      claim_expires_at = now() + interval '15 minutes',
      updated_at = now()
  where public.onboarding_journeys.user_id = candidate.user_id;

  return query select
    candidate.user_id,
    candidate.email::text,
    candidate.resolved_store_name::text,
    candidate.step::text,
    next_reminder,
    candidate.unsubscribe_token,
    candidate.last_activity_at;
end;
$$;

create or replace function public.complete_onboarding_reminder_claim(
  target_user_id uuid,
  target_reminder smallint
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.onboarding_journeys
  set first_reminder_sent_at = case
        when target_reminder = 1 then coalesce(first_reminder_sent_at, now())
        else first_reminder_sent_at
      end,
      second_reminder_sent_at = case
        when target_reminder = 2 then coalesce(second_reminder_sent_at, now())
        else second_reminder_sent_at
      end,
      cleanup_notice_sent_at = case
        when target_reminder = 3 then coalesce(cleanup_notice_sent_at, now())
        else cleanup_notice_sent_at
      end,
      claimed_reminder = null,
      claim_expires_at = null,
      updated_at = now()
  where user_id = target_user_id
    and claimed_reminder = target_reminder
    and target_reminder in (1, 2, 3);
$$;

create or replace function public.release_onboarding_reminder_claim(
  target_user_id uuid,
  target_reminder smallint
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.onboarding_journeys
  set claimed_reminder = null,
      claim_expires_at = null,
      updated_at = now()
  where user_id = target_user_id
    and claimed_reminder = target_reminder
    and target_reminder in (1, 2, 3);
$$;

revoke all on function public.touch_onboarding_activity(text) from public, anon;
revoke all on function public.claim_onboarding_reminder_v2() from public, anon, authenticated;
revoke all on function public.complete_onboarding_reminder_claim(uuid, smallint) from public, anon, authenticated;
revoke all on function public.release_onboarding_reminder_claim(uuid, smallint) from public, anon, authenticated;
grant execute on function public.touch_onboarding_activity(text) to authenticated;
grant execute on function public.claim_onboarding_reminder_v2() to service_role;
grant execute on function public.complete_onboarding_reminder_claim(uuid, smallint) to service_role;
grant execute on function public.release_onboarding_reminder_claim(uuid, smallint) to service_role;

alter table public.external_resource_cleanup
  drop constraint if exists external_resource_cleanup_provider_check;
alter table public.external_resource_cleanup
  drop constraint if exists external_resource_cleanup_resource_type_check;
alter table public.external_resource_cleanup
  drop constraint if exists external_resource_cleanup_resource_pair_check;
alter table public.external_resource_cleanup
  add constraint external_resource_cleanup_resource_pair_check
  check (
    (provider = 'stripe' and resource_type in ('connected_account', 'customer'))
    or (provider = 'supabase_storage' and resource_type = 'product_image_prefix')
  );

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
    'abandoned_drafts', deleted_abandoned_drafts,
    'tombstone_stores', deleted_tombstone_stores
  );
end;
$$;

revoke all on function public.apply_data_retention(timestamptz) from public, anon, authenticated;
grant execute on function public.apply_data_retention(timestamptz) to service_role;

comment on column public.onboarding_journeys.cleanup_notice_sent_at is
  'When the seven-day service notice for automatic empty-draft cleanup was accepted for delivery.';
comment on function public.apply_data_retention(timestamptz) is
  'Applies legal retention and deletes only notified, inactive, integration-free empty drafts.';

do $$
begin
  if has_function_privilege('anon', 'public.apply_data_retention(timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.apply_data_retention(timestamptz)', 'EXECUTE')
    or has_function_privilege('anon', 'public.claim_onboarding_reminder_v2()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_onboarding_reminder_v2()', 'EXECUTE')
  then
    raise exception 'ACCESS_ASSERTION_FAILED: draft cleanup maintenance is exposed to application roles';
  end if;
end;
$$;
