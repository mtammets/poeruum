create or replace function public.complete_onboarding_reminder_claim(target_user_id uuid, target_reminder smallint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.onboarding_journeys
  set first_reminder_sent_at = case when target_reminder = 1 then coalesce(first_reminder_sent_at, now()) else first_reminder_sent_at end,
      second_reminder_sent_at = case when target_reminder = 2 then coalesce(second_reminder_sent_at, now()) else second_reminder_sent_at end,
      claimed_reminder = null,
      claim_expires_at = null,
      updated_at = now()
  where user_id = target_user_id;
$$;

create or replace function public.release_onboarding_reminder_claim(target_user_id uuid, target_reminder smallint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.onboarding_journeys
  set claimed_reminder = null,
      claim_expires_at = now() + interval '30 minutes',
      updated_at = now()
  where user_id = target_user_id and claimed_reminder = target_reminder;
$$;

revoke all on function public.complete_onboarding_reminder_claim(uuid, smallint) from public, anon, authenticated;
revoke all on function public.release_onboarding_reminder_claim(uuid, smallint) from public, anon, authenticated;
grant execute on function public.complete_onboarding_reminder_claim(uuid, smallint) to service_role;
grant execute on function public.release_onboarding_reminder_claim(uuid, smallint) to service_role;
