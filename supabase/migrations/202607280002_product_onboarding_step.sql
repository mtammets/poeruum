alter table public.onboarding_journeys
drop constraint if exists onboarding_journeys_step_check;

alter table public.onboarding_journeys
add constraint onboarding_journeys_step_check
check (step in ('store', 'business', 'payments', 'shipping', 'product', 'publish', 'complete'));

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
      last_activity_at = case when public.onboarding_journeys.completed_at is null then now() else public.onboarding_journeys.last_activity_at end,
      claimed_reminder = null,
      claim_expires_at = null,
      updated_at = now();
end;
$$;
