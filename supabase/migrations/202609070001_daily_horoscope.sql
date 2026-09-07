create table public.daily_horoscopes (
  date date primary key,
  entries jsonb,
  generated_at timestamptz,
  claim_token uuid,
  claim_expires_at timestamptz,
  constraint daily_horoscopes_entries_object check (entries is null or jsonb_typeof(entries) = 'object')
);

alter table public.daily_horoscopes enable row level security;
revoke all on public.daily_horoscopes from public, anon, authenticated;
grant select (date, entries) on public.daily_horoscopes to anon, authenticated;
grant all on public.daily_horoscopes to service_role;

create policy daily_horoscopes_public_read on public.daily_horoscopes
for select to anon, authenticated
using (entries is not null and date = (now() at time zone 'Europe/Tallinn')::date);

-- A short lease keeps parallel invocations from paying for the same edition.
create function public.claim_daily_horoscope(edition_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  token uuid := gen_random_uuid();
  claimed uuid;
begin
  if edition_date < (now() at time zone 'Europe/Tallinn')::date
    or edition_date > (now() at time zone 'Europe/Tallinn')::date + 1 then
    raise exception 'Invalid horoscope date';
  end if;
  insert into public.daily_horoscopes (date, claim_token, claim_expires_at)
  values (edition_date, token, now() + interval '10 minutes')
  on conflict (date) do update
    set claim_token = excluded.claim_token, claim_expires_at = excluded.claim_expires_at
    where daily_horoscopes.entries is null
      and (daily_horoscopes.claim_expires_at is null or daily_horoscopes.claim_expires_at < now())
  returning claim_token into claimed;
  return claimed;
end;
$$;

revoke all on function public.claim_daily_horoscope(date) from public, anon, authenticated;
grant execute on function public.claim_daily_horoscope(date) to service_role;

-- Reuse the existing authenticated scheduler; completed editions are skipped.
do $$
begin
  perform cron.schedule(
    'poeruum-daily-horoscope',
    '15 * * * *',
    $schedule$
      select net.http_post(
        url := replace(
          (select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_reminders_url' limit 1),
          '/onboarding-reminders', '/daily-horoscope'
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_cron_secret' limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 180000
      )
      where exists (select 1 from vault.decrypted_secrets where name = 'onboarding_reminders_url')
        and exists (select 1 from vault.decrypted_secrets where name = 'onboarding_cron_secret');
    $schedule$
  );
end $$;
