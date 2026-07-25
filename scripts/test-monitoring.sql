\set ON_ERROR_STOP on

begin;

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
