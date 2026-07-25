\set ON_ERROR_STOP on

begin;

do $$
declare result record;
begin
  select * into result from public.consume_rate_limit(
    'security-test',
    repeat('a', 64),
    2,
    60
  );
  if not result.allowed or result.remaining <> 1 then
    raise exception 'First rate-limit request must be allowed';
  end if;

  select * into result from public.consume_rate_limit(
    'security-test',
    repeat('a', 64),
    2,
    60
  );
  if not result.allowed or result.remaining <> 0 then
    raise exception 'Second rate-limit request must be allowed';
  end if;

  select * into result from public.consume_rate_limit(
    'security-test',
    repeat('a', 64),
    2,
    60
  );
  if result.allowed or result.retry_after_seconds < 1 then
    raise exception 'Third rate-limit request must be rejected';
  end if;
end
$$;

select public.record_application_error(
  'security-test',
  'error',
  repeat('b', 64),
  'Synthetic monitoring event',
  '{"synthetic":true}'::jsonb
);

do $$
declare snapshot jsonb;
begin
  snapshot := public.monitor_system_snapshot(now());
  if (snapshot ->> 'recent_errors')::integer < 1 then
    raise exception 'Monitoring snapshot did not include the synthetic error';
  end if;
end
$$;

rollback;
