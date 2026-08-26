-- Keep Stripe verification notices in a private, service-owned state machine.
-- A store's first observed Connect state is only a baseline: this prevents a
-- deployment from emailing merchants about requirements that already existed.
-- Each episode gets one stable notification_id per stage. Edge retries must use
-- that ID as the Resend idempotency key; complete/release receive it as the
-- `target_notification_id` argument.

create table public.stripe_requirement_notification_state (
  store_id uuid primary key references public.stores(id) on delete cascade,
  stripe_account_id text not null,
  episode_id uuid,
  episode_suppressed boolean not null default false,
  episode_started_at timestamptz,
  action_required_notification_id uuid,
  deadline_7d_notification_id uuid,
  deadline_1d_notification_id uuid,
  action_required_sent_at timestamptz,
  deadline_7d_sent_at timestamptz,
  deadline_1d_sent_at timestamptz,
  claimed_notification_id uuid,
  claimed_kind text,
  claim_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint stripe_requirement_notification_episode_shape check (
    (
      episode_id is null
      and episode_started_at is null
      and action_required_notification_id is null
      and deadline_7d_notification_id is null
      and deadline_1d_notification_id is null
      and action_required_sent_at is null
      and deadline_7d_sent_at is null
      and deadline_1d_sent_at is null
      and claimed_notification_id is null
      and claimed_kind is null
      and claim_expires_at is null
    )
    or (
      episode_id is not null
      and episode_started_at is not null
      and action_required_notification_id is not null
      and deadline_7d_notification_id is not null
      and deadline_1d_notification_id is not null
    )
  ),
  constraint stripe_requirement_notification_claim_shape check (
    (
      claimed_notification_id is null
      and claimed_kind is null
      and claim_expires_at is null
    )
    or (
      claimed_notification_id is not null
      and claimed_kind in ('action_required', 'deadline_7d', 'deadline_1d')
      and claim_expires_at is not null
      and (
        (claimed_kind = 'action_required' and claimed_notification_id = action_required_notification_id)
        or (claimed_kind = 'deadline_7d' and claimed_notification_id = deadline_7d_notification_id)
        or (claimed_kind = 'deadline_1d' and claimed_notification_id = deadline_1d_notification_id)
      )
    )
  )
);

create unique index stripe_requirement_notification_active_claim_idx
on public.stripe_requirement_notification_state(claimed_notification_id)
where claimed_notification_id is not null;

create index stripe_requirement_notification_candidates_idx
on public.stripe_requirement_notification_state(episode_started_at)
where episode_id is not null;

alter table public.stripe_requirement_notification_state enable row level security;
revoke all on table public.stripe_requirement_notification_state from public, anon, authenticated;

create or replace function public.sync_stripe_requirement_notification_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_state public.stripe_requirement_notification_state%rowtype;
  is_actionable boolean;
  next_episode_id uuid;
begin
  -- Account deletion keeps some stores as accounting tombstones. They and
  -- disconnected accounts must not retain notification state.
  if new.owner_id is null or new.deleted_at is not null or new.stripe_account_id is null then
    delete from public.stripe_requirement_notification_state
    where store_id = new.id;
    return new;
  end if;

  -- pending_verification alone is Stripe review work, not merchant work. A
  -- disabled reason without pending verification does require merchant action.
  is_actionable := new.stripe_account_requirements_due_count > 0
    or new.stripe_account_requirements_past_due
    or (
      new.stripe_account_requirements_disabled_reason is not null
      and not new.stripe_account_requirements_pending_verification
    );

  select state.*
  into current_state
  from public.stripe_requirement_notification_state as state
  where state.store_id = new.id
  for update;

  if not found then
    -- The first observation is always a silent baseline. This applies both to
    -- merchants that predate the migration and to first-time Connect onboarding.
    next_episode_id := case when is_actionable then gen_random_uuid() end;
    insert into public.stripe_requirement_notification_state (
      store_id,
      stripe_account_id,
      episode_id,
      episode_suppressed,
      episode_started_at,
      action_required_notification_id,
      deadline_7d_notification_id,
      deadline_1d_notification_id,
      action_required_sent_at
    ) values (
      new.id,
      new.stripe_account_id,
      next_episode_id,
      is_actionable,
      case when is_actionable then now() end,
      case when is_actionable then gen_random_uuid() end,
      case when is_actionable then gen_random_uuid() end,
      case when is_actionable then gen_random_uuid() end,
      case when is_actionable then now() end
    );
    return new;
  end if;

  if current_state.stripe_account_id is distinct from new.stripe_account_id then
    -- Replacing the Connect account starts another silent baseline. Initial
    -- onboarding requirements must never generate service reminders.
    next_episode_id := case when is_actionable then gen_random_uuid() end;
    update public.stripe_requirement_notification_state
    set stripe_account_id = new.stripe_account_id,
        episode_id = next_episode_id,
        episode_suppressed = is_actionable,
        episode_started_at = case when is_actionable then now() end,
        action_required_notification_id = case when is_actionable then gen_random_uuid() end,
        deadline_7d_notification_id = case when is_actionable then gen_random_uuid() end,
        deadline_1d_notification_id = case when is_actionable then gen_random_uuid() end,
        action_required_sent_at = case when is_actionable then now() end,
        deadline_7d_sent_at = null,
        deadline_1d_sent_at = null,
        claimed_notification_id = null,
        claimed_kind = null,
        claim_expires_at = null,
        updated_at = now()
    where store_id = new.id;
    return new;
  end if;

  if not is_actionable then
    update public.stripe_requirement_notification_state
    set episode_id = null,
        episode_suppressed = false,
        episode_started_at = null,
        action_required_notification_id = null,
        deadline_7d_notification_id = null,
        deadline_1d_notification_id = null,
        action_required_sent_at = null,
        deadline_7d_sent_at = null,
        deadline_1d_sent_at = null,
        claimed_notification_id = null,
        claimed_kind = null,
        claim_expires_at = null,
        updated_at = now()
    where store_id = new.id
      and episode_id is not null;
    return new;
  end if;

  if current_state.episode_id is null then
    -- Only a clean -> actionable transition creates an emailable episode.
    update public.stripe_requirement_notification_state
    set episode_id = gen_random_uuid(),
        episode_suppressed = false,
        episode_started_at = now(),
        action_required_notification_id = gen_random_uuid(),
        deadline_7d_notification_id = gen_random_uuid(),
        deadline_1d_notification_id = gen_random_uuid(),
        action_required_sent_at = null,
        deadline_7d_sent_at = null,
        deadline_1d_sent_at = null,
        claimed_notification_id = null,
        claimed_kind = null,
        claim_expires_at = null,
        updated_at = now()
    where store_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_stripe_requirement_notification_state() from public, anon, authenticated;

drop trigger if exists stores_sync_stripe_requirement_notification_state on public.stores;
create trigger stores_sync_stripe_requirement_notification_state
after insert or update of
  owner_id,
  deleted_at,
  stripe_account_id,
  stripe_account_requirements_due_count,
  stripe_account_requirements_past_due,
  stripe_account_requirements_pending_verification,
  stripe_account_requirements_disabled_reason
on public.stores
for each row execute function public.sync_stripe_requirement_notification_state();

-- Seed every existing connected store after the trigger exists. An observed
-- actionable state suppresses only the immediate action-required email by
-- recording it as handled; deadline reminders remain eligible later. A store
-- whose requirement summary has never been synced gets the same silent
-- placeholder episode until its first authoritative Stripe update. This avoids
-- treating the migration's default zero values as a known-clean baseline.
insert into public.stripe_requirement_notification_state (
  store_id,
  stripe_account_id,
  episode_id,
  episode_suppressed,
  episode_started_at,
  action_required_notification_id,
  deadline_7d_notification_id,
  deadline_1d_notification_id,
  action_required_sent_at
)
select
  store.id,
  store.stripe_account_id,
  case when baseline.is_actionable or store.stripe_account_requirements_updated_at is null then gen_random_uuid() end,
  baseline.is_actionable or store.stripe_account_requirements_updated_at is null,
  case when baseline.is_actionable or store.stripe_account_requirements_updated_at is null then now() end,
  case when baseline.is_actionable or store.stripe_account_requirements_updated_at is null then gen_random_uuid() end,
  case when baseline.is_actionable or store.stripe_account_requirements_updated_at is null then gen_random_uuid() end,
  case when baseline.is_actionable or store.stripe_account_requirements_updated_at is null then gen_random_uuid() end,
  case when baseline.is_actionable or store.stripe_account_requirements_updated_at is null then now() end
from public.stores as store
cross join lateral (
  select (
    store.stripe_account_requirements_due_count > 0
    or store.stripe_account_requirements_past_due
    or (
      store.stripe_account_requirements_disabled_reason is not null
      and not store.stripe_account_requirements_pending_verification
    )
  ) as is_actionable
) as baseline
where store.owner_id is not null
  and store.deleted_at is null
  and store.stripe_account_id is not null
on conflict (store_id) do nothing;

create or replace function public.claim_stripe_requirement_notification()
returns table (
  notification_id uuid,
  store_id uuid,
  email text,
  store_name text,
  kind text,
  deadline timestamptz,
  due_count integer,
  past_due boolean,
  disabled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  next_notification_id uuid;
begin
  select
    state.*,
    store.name as resolved_store_name,
    store.stripe_account_requirements_deadline as resolved_deadline,
    store.stripe_account_requirements_due_count as resolved_due_count,
    store.stripe_account_requirements_past_due as resolved_past_due,
    (store.stripe_account_requirements_disabled_reason is not null) as resolved_disabled,
    users.email as resolved_email,
    eligibility.next_kind
  into candidate
  from public.stripe_requirement_notification_state as state
  join public.stores as store
    on store.id = state.store_id
    and store.stripe_account_id = state.stripe_account_id
  join auth.users as users on users.id = store.owner_id
  cross join lateral (
    select case
      when state.action_required_sent_at is null
        and not state.episode_suppressed
        and state.episode_started_at <= now() - interval '15 minutes'
        then 'action_required'
      when state.deadline_1d_sent_at is null
        and state.action_required_sent_at is not null
        and store.stripe_account_requirements_deadline > now()
        and store.stripe_account_requirements_deadline <= now() + interval '1 day'
        and state.episode_started_at <= store.stripe_account_requirements_deadline - interval '1 day'
        and greatest(
          state.action_required_sent_at,
          coalesce(state.deadline_7d_sent_at, '-infinity'::timestamptz)
        ) <= now() - interval '12 hours'
        then 'deadline_1d'
      when state.deadline_7d_sent_at is null
        and state.action_required_sent_at is not null
        and store.stripe_account_requirements_deadline > now() + interval '1 day'
        and store.stripe_account_requirements_deadline <= now() + interval '7 days'
        and state.episode_started_at <= store.stripe_account_requirements_deadline - interval '7 days'
        and state.action_required_sent_at <= now() - interval '12 hours'
        then 'deadline_7d'
    end as next_kind
  ) as eligibility
  where state.episode_id is not null
    and (state.claim_expires_at is null or state.claim_expires_at < now())
    and store.owner_id is not null
    and store.deleted_at is null
    and store.stripe_account_id is not null
    and (
      store.stripe_account_requirements_due_count > 0
      or store.stripe_account_requirements_past_due
      or (
        store.stripe_account_requirements_disabled_reason is not null
        and not store.stripe_account_requirements_pending_verification
      )
    )
    and users.email_confirmed_at is not null
    and users.email is not null
    and coalesce(users.raw_app_meta_data ->> 'role', '') <> 'admin'
    and eligibility.next_kind is not null
  order by
    case eligibility.next_kind
      when 'deadline_1d' then 1
      when 'deadline_7d' then 2
      else 3
    end,
    store.stripe_account_requirements_deadline nulls last,
    state.episode_started_at
  limit 1
  for update of state skip locked;

  if not found then return; end if;

  next_notification_id := case candidate.next_kind
    when 'action_required' then candidate.action_required_notification_id
    when 'deadline_7d' then candidate.deadline_7d_notification_id
    when 'deadline_1d' then candidate.deadline_1d_notification_id
  end;

  update public.stripe_requirement_notification_state as state
  set claimed_notification_id = next_notification_id,
      claimed_kind = candidate.next_kind,
      claim_expires_at = now() + interval '15 minutes',
      updated_at = now()
  where state.store_id = candidate.store_id;

  return query select
    next_notification_id,
    candidate.store_id,
    candidate.resolved_email::text,
    candidate.resolved_store_name::text,
    candidate.next_kind::text,
    candidate.resolved_deadline,
    candidate.resolved_due_count,
    candidate.resolved_past_due,
    candidate.resolved_disabled;
end;
$$;

create or replace function public.complete_stripe_requirement_notification(target_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed_count integer;
begin
  update public.stripe_requirement_notification_state as state
  set action_required_sent_at = case
        when state.claimed_kind = 'action_required' then coalesce(state.action_required_sent_at, now())
        else state.action_required_sent_at
      end,
      deadline_7d_sent_at = case
        when state.claimed_kind = 'deadline_7d' then coalesce(state.deadline_7d_sent_at, now())
        else state.deadline_7d_sent_at
      end,
      deadline_1d_sent_at = case
        when state.claimed_kind = 'deadline_1d' then coalesce(state.deadline_1d_sent_at, now())
        else state.deadline_1d_sent_at
      end,
      claimed_notification_id = null,
      claimed_kind = null,
      claim_expires_at = null,
      updated_at = now()
  where state.claimed_notification_id = target_notification_id;
  get diagnostics completed_count = row_count;
  return completed_count = 1;
end;
$$;

create or replace function public.release_stripe_requirement_notification(target_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released_count integer;
begin
  update public.stripe_requirement_notification_state as state
  -- Keep the stable notification ID leased briefly after a failed send. This
  -- prevents one Edge invocation from claiming and retrying the same failure
  -- repeatedly in its processing loop. The next cron can reclaim it after the
  -- backoff without changing the Resend idempotency key.
  set claim_expires_at = now() + interval '30 minutes',
      updated_at = now()
  where state.claimed_notification_id = target_notification_id;
  get diagnostics released_count = row_count;
  return released_count = 1;
end;
$$;

revoke all on function public.claim_stripe_requirement_notification() from public, anon, authenticated;
revoke all on function public.complete_stripe_requirement_notification(uuid) from public, anon, authenticated;
revoke all on function public.release_stripe_requirement_notification(uuid) from public, anon, authenticated;
grant execute on function public.claim_stripe_requirement_notification() to service_role;
grant execute on function public.complete_stripe_requirement_notification(uuid) to service_role;
grant execute on function public.release_stripe_requirement_notification(uuid) to service_role;

comment on table public.stripe_requirement_notification_state is
  'Private per-store Stripe requirement episode and email delivery claim state. The first observed episode is suppressed.';
comment on function public.claim_stripe_requirement_notification() is
  'Atomically leases one due Stripe requirement service notification for a confirmed non-admin merchant email.';

do $$
declare
  existing_job bigint;
  reminder_url text;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'poeruum-stripe-requirement-notifications';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;

  select nullif(trim(decrypted_secret), '')
  into reminder_url
  from vault.decrypted_secrets
  where name = 'onboarding_reminders_url'
  limit 1;

  if reminder_url is null
    or not exists (
      select 1
      from vault.decrypted_secrets
      where name = 'onboarding_cron_secret'
        and nullif(trim(decrypted_secret), '') is not null
    )
  then
    raise notice 'Stripe requirement notification schedule skipped because Vault secrets are not configured.';
    return;
  end if;

  if position('/onboarding-reminders' in reminder_url) = 0 then
    raise notice 'Stripe requirement notification schedule skipped because the configured reminder URL is unexpected.';
    return;
  end if;

  perform cron.schedule(
    'poeruum-stripe-requirement-notifications',
    '17 * * * *',
    $schedule$
      select net.http_post(
        url := replace(
          (select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_reminders_url' limit 1),
          '/onboarding-reminders',
          '/stripe-requirement-notifications'
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
  if has_table_privilege('anon', 'public.stripe_requirement_notification_state', 'SELECT')
    or has_table_privilege('authenticated', 'public.stripe_requirement_notification_state', 'SELECT')
    or has_function_privilege('anon', 'public.claim_stripe_requirement_notification()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_stripe_requirement_notification()', 'EXECUTE')
  then
    raise exception 'ACCESS_ASSERTION_FAILED: Stripe requirement notification state is exposed to application roles';
  end if;
end;
$$;
