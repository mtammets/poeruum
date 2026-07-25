create table public.rate_limit_windows (
  action text not null check (char_length(action) between 1 and 80),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  hit_count integer not null default 1 check (hit_count > 0),
  expires_at timestamptz not null,
  primary key (action, key_hash, window_started_at)
);

create index rate_limit_windows_expires_at_idx
  on public.rate_limit_windows(expires_at);

alter table public.rate_limit_windows enable row level security;
revoke all on table public.rate_limit_windows from public, anon, authenticated;
grant select, insert, update, delete on table public.rate_limit_windows to service_role;

create or replace function public.consume_rate_limit(
  action_value text,
  key_hash_value text,
  limit_value integer,
  window_seconds_value integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_time timestamptz := clock_timestamp();
  window_start timestamptz;
  next_expiry timestamptz;
  current_hits integer;
begin
  if action_value is null or char_length(action_value) not between 1 and 80
    or key_hash_value !~ '^[a-f0-9]{64}$'
    or limit_value not between 1 and 10000
    or window_seconds_value not between 1 and 86400
  then
    raise exception 'Invalid rate-limit configuration' using errcode = '22023';
  end if;

  window_start := to_timestamp(
    floor(extract(epoch from request_time) / window_seconds_value) * window_seconds_value
  );
  next_expiry := window_start + make_interval(secs => window_seconds_value);

  insert into public.rate_limit_windows (
    action, key_hash, window_started_at, hit_count, expires_at
  ) values (
    action_value, key_hash_value, window_start, 1, next_expiry
  )
  on conflict (action, key_hash, window_started_at)
  do update set hit_count = public.rate_limit_windows.hit_count + 1
  returning hit_count into current_hits;

  return query select
    current_hits <= limit_value,
    greatest(0, limit_value - current_hits),
    greatest(1, ceil(extract(epoch from next_expiry - request_time))::integer);
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;

create table public.application_error_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (char_length(source) between 1 and 100),
  severity text not null check (severity in ('warning', 'error', 'critical')),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  message text not null check (char_length(message) between 1 and 500),
  context jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index application_error_events_occurred_at_idx
  on public.application_error_events(occurred_at desc);
create index application_error_events_fingerprint_idx
  on public.application_error_events(fingerprint, occurred_at desc);

alter table public.application_error_events enable row level security;
revoke all on table public.application_error_events from public, anon, authenticated;
grant select, insert, delete on table public.application_error_events to service_role;

create or replace function public.record_application_error(
  source_value text,
  severity_value text,
  fingerprint_value text,
  message_value text,
  context_value jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare event_id uuid;
begin
  insert into public.application_error_events (source, severity, fingerprint, message, context)
  values (
    left(coalesce(nullif(btrim(source_value), ''), 'unknown'), 100),
    case when severity_value in ('warning', 'error', 'critical') then severity_value else 'error' end,
    fingerprint_value,
    left(coalesce(nullif(btrim(message_value), ''), 'Unknown application error'), 500),
    coalesce(context_value, '{}'::jsonb)
  )
  returning id into event_id;
  return event_id;
end;
$$;

revoke all on function public.record_application_error(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_application_error(text, text, text, text, jsonb) to service_role;

create table public.monitor_alert_states (
  alert_key text primary key check (char_length(alert_key) between 1 and 100),
  status text not null check (status in ('open', 'resolved')),
  summary text not null default '',
  first_failed_at timestamptz,
  last_checked_at timestamptz not null default now(),
  last_alerted_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger monitor_alert_states_updated_at
before update on public.monitor_alert_states
for each row execute function public.set_updated_at();

alter table public.monitor_alert_states enable row level security;
revoke all on table public.monitor_alert_states from public, anon, authenticated;
grant select, insert, update on table public.monitor_alert_states to service_role;

create or replace function public.monitor_system_snapshot(reference_time timestamptz default now())
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'recent_errors', (
      select count(*) from public.application_error_events
      where occurred_at >= reference_time - interval '5 minutes'
        and severity in ('error', 'critical')
    ),
    'recent_critical_errors', (
      select count(*) from public.application_error_events
      where occurred_at >= reference_time - interval '15 minutes'
        and severity = 'critical'
    ),
    'failed_cron_runs', (
      select count(*)
      from cron.job_run_details as run
      join cron.job as job on job.jobid = run.jobid
      where run.start_time >= reference_time - interval '15 minutes'
        and run.status = 'failed'
        and job.jobname <> 'poeruum-health-monitor'
    )
  );
$$;

revoke all on function public.monitor_system_snapshot(timestamptz) from public, anon, authenticated;
grant execute on function public.monitor_system_snapshot(timestamptz) to service_role;

create or replace function public.cleanup_security_observability(reference_time timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_rate_limits integer := 0;
  deleted_error_events integer := 0;
begin
  delete from public.rate_limit_windows where expires_at < reference_time;
  get diagnostics deleted_rate_limits = row_count;

  delete from public.application_error_events
  where occurred_at < reference_time - interval '30 days';
  get diagnostics deleted_error_events = row_count;

  return jsonb_build_object(
    'rate_limit_windows', deleted_rate_limits,
    'application_error_events', deleted_error_events
  );
end;
$$;

revoke all on function public.cleanup_security_observability(timestamptz) from public, anon, authenticated;
grant execute on function public.cleanup_security_observability(timestamptz) to service_role;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'poeruum-health-monitor';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'onboarding_reminders_url'
  ) or not exists (
    select 1 from vault.decrypted_secrets where name = 'onboarding_cron_secret'
  ) then
    raise notice 'Health monitor schedule skipped because Vault secrets are not configured.';
    return;
  end if;
  perform cron.schedule(
    'poeruum-health-monitor',
    '*/5 * * * *',
    $schedule$
      select net.http_post(
        url := replace(
          (select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_reminders_url' limit 1),
          '/onboarding-reminders',
          '/monitor-health'
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
  if has_function_privilege('anon', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.record_application_error(text,text,text,text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.record_application_error(text,text,text,text,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.monitor_system_snapshot(timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.monitor_system_snapshot(timestamptz)', 'EXECUTE')
    or has_function_privilege('anon', 'public.cleanup_security_observability(timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.cleanup_security_observability(timestamptz)', 'EXECUTE')
  then
    raise exception 'Security maintenance functions must not be callable by application roles';
  end if;
end
$$;
