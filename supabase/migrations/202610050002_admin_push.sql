-- Device subscriptions are private capabilities, never readable through the app API.
create table public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 20 and 2048),
  p256dh text not null check (length(p256dh) = 87),
  auth text not null check (length(auth) = 22),
  created_at timestamptz not null default now()
);
create index admin_push_subscriptions_user_idx on public.admin_push_subscriptions(user_id);

create table public.admin_push_jobs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.admin_push_subscriptions(id) on delete cascade,
  event_id uuid not null,
  kind text not null check (kind in ('visit', 'account')),
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  unique (subscription_id, event_id, kind)
);
create index admin_push_jobs_available_idx on public.admin_push_jobs(available_at);
alter table public.admin_push_subscriptions enable row level security;
alter table public.admin_push_jobs enable row level security;
revoke all on public.admin_push_subscriptions, public.admin_push_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.admin_push_subscriptions, public.admin_push_jobs to service_role;

-- pg_net sends after commit. Missing configuration must never block signups or visits.
create function public.dispatch_admin_push()
returns void language plpgsql security definer set search_path = '' as $$
declare reminder_url text; cron_secret text;
begin
  if not exists (select 1 from public.admin_push_jobs where available_at <= now()) then return; end if;
  select decrypted_secret into reminder_url from vault.decrypted_secrets where name = 'onboarding_reminders_url' limit 1;
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'onboarding_cron_secret' limit 1;
  if reminder_url is null or reminder_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/onboarding-reminders$'
    or nullif(cron_secret, '') is null then return; end if;
  perform net.http_post(
    url := replace(reminder_url, '/onboarding-reminders', '/admin-push-dispatch'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cron_secret),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
exception when others then
  -- The minute-by-minute worker will retry; do not disclose Vault values in logs.
  raise warning 'Admin push dispatch deferred';
end;
$$;

create function public.enqueue_admin_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare notice_kind text := tg_argv[0];
begin
  insert into public.admin_push_jobs(subscription_id, event_id, kind)
  select subscription.id, new.id, notice_kind
  from public.admin_push_subscriptions subscription
  join auth.users users on users.id = subscription.user_id
  where users.raw_app_meta_data ->> 'role' = 'admin'
  on conflict do nothing;
  if found then perform public.dispatch_admin_push(); end if;
  return null;
end;
$$;
create trigger admin_push_after_visit after insert on public.homepage_analytics_events
  for each row when (new.event_name = 'page_view') execute function public.enqueue_admin_push('visit');
create trigger admin_push_after_account after insert on auth.users
  for each row when (coalesce(new.raw_app_meta_data ->> 'role', '') <> 'admin') execute function public.enqueue_admin_push('account');

create function public.claim_admin_push_job()
returns table(id uuid, lease_token uuid, subscription_id uuid, endpoint text, p256dh text, auth text, kind text)
language plpgsql security definer set search_path = '' as $$
declare claimed public.admin_push_jobs%rowtype;
begin
  -- Revoked admin access stops delivery even if an old browser JWT still exists.
  delete from public.admin_push_subscriptions subscription
  where not exists (select 1 from auth.users users where users.id = subscription.user_id and users.raw_app_meta_data ->> 'role' = 'admin');
  delete from public.admin_push_jobs job where job.created_at < now() - interval '1 hour'
    or (job.attempts >= 5 and job.available_at <= now());
  select job.* into claimed from public.admin_push_jobs job
  where job.available_at <= now() and job.attempts < 5
  order by job.created_at limit 1 for update skip locked;
  if not found then return; end if;
  update public.admin_push_jobs job set attempts = attempts + 1,
    available_at = now() + interval '2 minutes', lease_token = gen_random_uuid()
  where job.id = claimed.id returning job.* into claimed;
  return query select claimed.id, claimed.lease_token, subscription.id,
    subscription.endpoint, subscription.p256dh, subscription.auth, claimed.kind
  from public.admin_push_subscriptions subscription where subscription.id = claimed.subscription_id;
end;
$$;

create function public.finish_admin_push_job(target_id uuid, target_token uuid, outcome text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target public.admin_push_jobs%rowtype;
begin
  select * into target from public.admin_push_jobs where id = target_id and lease_token = target_token for update;
  if not found then return false; end if;
  if outcome = 'gone' then
    delete from public.admin_push_subscriptions where id = target.subscription_id;
  elsif outcome = 'sent' then
    delete from public.admin_push_jobs where id = target.id;
  elsif outcome = 'retry' then
    update public.admin_push_jobs set lease_token = null,
      available_at = now() + make_interval(secs => least(900, 30 * (2 ^ target.attempts)::integer)) where id = target.id;
  else
    raise exception 'Invalid push outcome';
  end if;
  return true;
end;
$$;
revoke all on function public.dispatch_admin_push(), public.enqueue_admin_push(), public.claim_admin_push_job(), public.finish_admin_push_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.dispatch_admin_push(), public.claim_admin_push_job(), public.finish_admin_push_job(uuid, uuid, text) to service_role;
-- Safe even before Vault is configured; also drains jobs after a transient outage.
select cron.schedule('poeruum-admin-push', '* * * * *', 'select public.dispatch_admin_push()');
