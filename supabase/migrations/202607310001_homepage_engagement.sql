-- Measure only active, foreground time for the existing anonymous homepage
-- session. The browser sends a capped cumulative value so duplicate and
-- out-of-order requests cannot inflate or roll back the stored duration.

alter table public.homepage_analytics_events
  add column engaged_seconds integer
  check (engaged_seconds between 0 and 1800);

comment on column public.homepage_analytics_events.engaged_seconds is
  'Cumulative seconds that the marketing homepage was visible and focused, capped at 30 minutes. Null means duration measurement was not yet active; used only on page_view rows.';

create or replace function public.record_homepage_engagement(
  target_session_id text,
  target_audience text,
  target_referrer_host text,
  target_utm_source text,
  target_utm_medium text,
  target_utm_campaign text,
  target_device_type text,
  target_engaged_seconds integer
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.homepage_analytics_events as existing (
    session_id,
    event_name,
    event_label,
    audience,
    referrer_host,
    utm_source,
    utm_medium,
    utm_campaign,
    device_type,
    engaged_seconds
  )
  values (
    target_session_id,
    'page_view',
    '',
    target_audience,
    target_referrer_host,
    target_utm_source,
    target_utm_medium,
    target_utm_campaign,
    target_device_type,
    target_engaged_seconds
  )
  on conflict (session_id, event_name, event_label) do update
  set engaged_seconds = greatest(
    coalesce(existing.engaged_seconds, 0),
    excluded.engaged_seconds
  );
$$;

revoke all on function public.record_homepage_engagement(text, text, text, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.record_homepage_engagement(text, text, text, text, text, text, text, integer)
  to service_role;

create or replace function public.admin_homepage_engagement(requested_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  range_start timestamptz;
  range_start_date date;
  range_end_date date := (now() at time zone 'Europe/Tallinn')::date;
  result jsonb;
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if requested_days is null or requested_days not in (7, 30, 90) then
    raise exception 'Analytics range must be 7, 30 or 90 days';
  end if;

  range_start_date := range_end_date - (requested_days - 1);
  range_start := range_start_date::timestamp at time zone 'Europe/Tallinn';

  with
  page_views as materialized (
    select
      event.session_id,
      event.referrer_host,
      event.utm_source,
      event.engaged_seconds
    from public.homepage_analytics_events as event
    where event.occurred_at >= range_start
      and event.event_name = 'page_view'
  ),
  source_rows as (
    select
      case
        when nullif(page_view_row.utm_source, '') is not null then page_view_row.utm_source
        when nullif(page_view_row.referrer_host, '') is not null then page_view_row.referrer_host
        else 'Otse'
      end as source,
      count(*)::integer as sessions,
      count(page_view_row.engaged_seconds)::integer as measured_sessions,
      count(*) filter (where page_view_row.engaged_seconds >= 10)::integer as engaged_sessions,
      coalesce(round(avg(page_view_row.engaged_seconds)), 0)::integer as average_engaged_seconds
    from page_views as page_view_row
    group by 1
    order by sessions desc, source
    limit 8
  )
  select jsonb_build_object(
    'range_days', requested_days,
    'average_engaged_seconds', coalesce((
      select round(avg(page_view_row.engaged_seconds))::integer
      from page_views as page_view_row
    ), 0),
    'measured_sessions', (
      select count(page_view_row.engaged_seconds)::integer
      from page_views as page_view_row
    ),
    'engaged_sessions', (
      select count(*)::integer
      from page_views as page_view_row
      where page_view_row.engaged_seconds >= 10
    ),
    'engagement_buckets', jsonb_build_array(
      jsonb_build_object(
        'bucket', 'under_10',
        'sessions', (select count(*)::integer from page_views where engaged_seconds < 10)
      ),
      jsonb_build_object(
        'bucket', '10_29',
        'sessions', (select count(*)::integer from page_views where engaged_seconds between 10 and 29)
      ),
      jsonb_build_object(
        'bucket', '30_119',
        'sessions', (select count(*)::integer from page_views where engaged_seconds between 30 and 119)
      ),
      jsonb_build_object(
        'bucket', '120_plus',
        'sessions', (select count(*)::integer from page_views where engaged_seconds >= 120)
      )
    ),
    'sources', coalesce((
      select jsonb_agg(to_jsonb(source_rows) order by source_rows.sessions desc, source_rows.source)
      from source_rows
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

revoke all on function public.admin_homepage_engagement(integer) from public, anon;
grant execute on function public.admin_homepage_engagement(integer) to authenticated;
