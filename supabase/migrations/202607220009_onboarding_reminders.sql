create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table public.onboarding_journeys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  step text not null default 'store' check (step in ('store', 'business', 'payments', 'shipping', 'publish', 'complete')),
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz,
  reminders_disabled_at timestamptz,
  first_reminder_sent_at timestamptz,
  second_reminder_sent_at timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  claimed_reminder smallint check (claimed_reminder in (1, 2)),
  claim_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index onboarding_journeys_reminder_candidates_idx
on public.onboarding_journeys(last_activity_at)
where completed_at is null and reminders_disabled_at is null and second_reminder_sent_at is null;

alter table public.onboarding_journeys enable row level security;
revoke all on table public.onboarding_journeys from public, anon, authenticated;

create or replace function public.create_onboarding_journey_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'role', '') <> 'admin' then
    insert into public.onboarding_journeys (user_id, step, last_activity_at)
    values (new.id, 'store', now())
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists auth_user_onboarding_journey on auth.users;
create trigger auth_user_onboarding_journey
after insert on auth.users
for each row execute function public.create_onboarding_journey_for_user();

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
  next_step := case
    when new.is_published then 'complete'
    when new.settings ->> 'onboardingStep' in ('store', 'business', 'payments', 'shipping', 'publish') then new.settings ->> 'onboardingStep'
    else 'business'
  end;

  insert into public.onboarding_journeys (user_id, store_id, step, last_activity_at, completed_at)
  values (new.owner_id, new.id, next_step, now(), case when new.is_published then now() end)
  on conflict (user_id) do update
  set store_id = excluded.store_id,
      step = case when public.onboarding_journeys.completed_at is not null then 'complete' else excluded.step end,
      last_activity_at = case when public.onboarding_journeys.completed_at is null then now() else public.onboarding_journeys.last_activity_at end,
      completed_at = coalesce(public.onboarding_journeys.completed_at, excluded.completed_at),
      claimed_reminder = null,
      claim_expires_at = null,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists store_onboarding_journey on public.stores;
create trigger store_onboarding_journey
after insert or update of is_published, settings, payment_status, shipping on public.stores
for each row execute function public.sync_store_onboarding_journey();

insert into public.onboarding_journeys (user_id, store_id, step, last_activity_at, completed_at)
select
  users.id,
  store.id,
  case
    when store.is_published then 'complete'
    when store.settings ->> 'onboardingStep' in ('store', 'business', 'payments', 'shipping', 'publish') then store.settings ->> 'onboardingStep'
    when store.id is null then 'store'
    else 'business'
  end,
  now(),
  case when store.is_published then now() end
from auth.users as users
left join lateral (
  select candidate.* from public.stores as candidate
  where candidate.owner_id = users.id
  order by candidate.created_at
  limit 1
) as store on true
where coalesce(users.raw_app_meta_data ->> 'role', '') <> 'admin'
on conflict (user_id) do nothing;

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
  if target_step not in ('store', 'business', 'payments', 'shipping', 'publish') then
    raise exception 'Invalid onboarding step';
  end if;

  insert into public.onboarding_journeys (user_id, step, last_activity_at)
  values (current_user_id, target_step, now())
  on conflict (user_id) do update
  set step = case when public.onboarding_journeys.completed_at is null then excluded.step else 'complete' end,
      last_activity_at = case when public.onboarding_journeys.completed_at is null then now() else public.onboarding_journeys.last_activity_at end,
      claimed_reminder = null,
      claim_expires_at = null,
      updated_at = now();
end;
$$;

create or replace function public.disable_onboarding_reminders(target_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed boolean;
begin
  update public.onboarding_journeys
  set reminders_disabled_at = coalesce(reminders_disabled_at, now()),
      claimed_reminder = null,
      claim_expires_at = null,
      updated_at = now()
  where unsubscribe_token = target_token;
  changed := found;
  return changed;
end;
$$;

create or replace function public.claim_onboarding_reminder()
returns table (
  user_id uuid,
  email text,
  store_name text,
  onboarding_step text,
  reminder_number smallint,
  unsubscribe_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  next_reminder smallint;
begin
  select journey.*, users.email, coalesce(store.name, 'Sinu pood') as resolved_store_name
  into candidate
  from public.onboarding_journeys as journey
  join auth.users as users on users.id = journey.user_id
  left join public.stores as store on store.id = journey.store_id
  where journey.completed_at is null
    and journey.reminders_disabled_at is null
    and journey.step <> 'complete'
    and users.email_confirmed_at is not null
    and users.email is not null
    and journey.last_activity_at <= now() - interval '3 hours'
    and (journey.claim_expires_at is null or journey.claim_expires_at < now())
    and not exists (
      select 1 from public.user_presence_sessions as presence
      where presence.user_id = journey.user_id
        and presence.last_seen_at >= now() - interval '5 minutes'
    )
    and (
      journey.first_reminder_sent_at is null
      or (
        journey.second_reminder_sent_at is null
        and journey.last_activity_at <= now() - interval '24 hours'
        and journey.first_reminder_sent_at <= now() - interval '18 hours'
      )
    )
  order by journey.last_activity_at
  limit 1
  for update of journey skip locked;

  if not found then return; end if;
  next_reminder := case when candidate.first_reminder_sent_at is null then 1 else 2 end;

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
    candidate.unsubscribe_token;
end;
$$;

create or replace function public.complete_onboarding_reminder_claim(target_user_id uuid, target_reminder smallint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.onboarding_journeys
  set first_reminder_sent_at = case when target_reminder = 1 then now() else first_reminder_sent_at end,
      second_reminder_sent_at = case when target_reminder = 2 then now() else second_reminder_sent_at end,
      claimed_reminder = null,
      claim_expires_at = null,
      updated_at = now()
  where user_id = target_user_id and claimed_reminder = target_reminder;
$$;

create or replace function public.release_onboarding_reminder_claim(target_user_id uuid, target_reminder smallint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.onboarding_journeys
  set claimed_reminder = null, claim_expires_at = null, updated_at = now()
  where user_id = target_user_id and claimed_reminder = target_reminder;
$$;

revoke all on function public.touch_onboarding_activity(text) from public, anon;
revoke all on function public.disable_onboarding_reminders(uuid) from public;
revoke all on function public.claim_onboarding_reminder() from public, anon, authenticated;
revoke all on function public.complete_onboarding_reminder_claim(uuid, smallint) from public, anon, authenticated;
revoke all on function public.release_onboarding_reminder_claim(uuid, smallint) from public, anon, authenticated;
grant execute on function public.touch_onboarding_activity(text) to authenticated;
grant execute on function public.disable_onboarding_reminders(uuid) to anon, authenticated;
grant execute on function public.claim_onboarding_reminder() to service_role;
grant execute on function public.complete_onboarding_reminder_claim(uuid, smallint) to service_role;
grant execute on function public.release_onboarding_reminder_claim(uuid, smallint) to service_role;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'poeruum-onboarding-reminders';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'poeruum-onboarding-reminders',
    '0 * * * *',
    $schedule$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_reminders_url' limit 1),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_cron_secret' limit 1)
        ),
        body := '{}'::jsonb
      );
    $schedule$
  );
end $$;
