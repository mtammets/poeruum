\set ON_ERROR_STOP on

delete from public.rate_limit_windows where action = 'security-ci-test';

do $$
declare result record;
begin
  select * into result from public.consume_rate_limit(
    'security-ci-test',
    repeat('a', 64),
    2,
    3600
  );
  if result.allowed is distinct from true or result.remaining is distinct from 1 then
    raise exception 'First rate-limit request returned allowed=%, remaining=%',
      result.allowed, result.remaining;
  end if;
end
$$;
