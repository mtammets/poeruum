\set ON_ERROR_STOP on

do $$
declare result record;
begin
  select * into result from public.consume_rate_limit(
    'security-ci-test',
    repeat('a', 64),
    2,
    3600
  );
  if result.allowed is distinct from false or result.retry_after_seconds < 1 then
    raise exception 'Third rate-limit request returned allowed=%, retry_after=%',
      result.allowed, result.retry_after_seconds;
  end if;
end
$$;

delete from public.rate_limit_windows where action = 'security-ci-test';
