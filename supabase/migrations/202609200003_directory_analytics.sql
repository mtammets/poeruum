create table public.directory_analytics_settings (
  id boolean primary key default true check (id),
  started_at timestamptz not null default now()
);
insert into public.directory_analytics_settings (id) values (true);

create table public.directory_analytics_events (
  id uuid primary key,
  session_id uuid not null,
  event_name text not null check (event_name in ('page_view', 'store_impression', 'store_click', 'product_click', 'search')),
  event_key text not null,
  -- Keep historical IDs and public labels when a merchant deletes a store/product.
  store_id uuid,
  store_name text,
  product_id text,
  product_name text,
  placement text check (placement in ('directory', 'search')),
  position integer check (position between 1 and 10000),
  result_count integer check (result_count between 0 and 100000),
  referrer_host text not null default '' check (char_length(referrer_host) <= 120),
  utm_source text not null default '' check (char_length(utm_source) <= 80),
  device_type text not null check (device_type in ('mobile', 'tablet', 'desktop')),
  occurred_at timestamptz not null default now(),
  unique (session_id, event_name, event_key)
);
create index directory_analytics_events_time_idx on public.directory_analytics_events (occurred_at);
create index directory_analytics_events_store_time_idx on public.directory_analytics_events (store_id, occurred_at);
alter table public.directory_analytics_events enable row level security;
alter table public.directory_analytics_settings enable row level security;
revoke all on public.directory_analytics_events, public.directory_analytics_settings from public, anon, authenticated;

-- Only the validated/rate-limited Edge Function can ingest public events.
create function public.record_directory_analytics(events jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item record;
  store_label text;
  product_label text;
  dedup_key text;
  inserted integer;
  accepted integer := 0;
begin
  if events is null or jsonb_typeof(events) <> 'array' then
    raise exception 'Invalid event batch' using errcode = '22023';
  end if;
  if jsonb_array_length(events) not between 1 and 20 then
    raise exception 'Invalid event batch size' using errcode = '22023';
  end if;
  for item in select * from jsonb_to_recordset(events) as e(
    id uuid, session_id uuid, event_name text, store_id uuid, product_id text,
    placement text, position integer, result_count integer,
    referrer_host text, utm_source text, device_type text
  ) loop
    if item.id is null or item.session_id is null or item.event_name is null
      or item.event_name not in ('page_view', 'store_impression', 'store_click', 'product_click', 'search')
      or item.device_type is null or item.device_type not in ('mobile', 'tablet', 'desktop')
      or char_length(coalesce(item.referrer_host, '')) > 120
      or char_length(coalesce(item.utm_source, '')) > 80 then
      raise exception 'Invalid event' using errcode = '22023';
    end if;
    store_label := null;
    product_label := null;
    if item.event_name in ('store_impression', 'store_click', 'product_click') then
      if item.store_id is null or item.position is null or item.position not between 1 and 10000
        or item.placement is null or item.placement not in ('directory', 'search')
        or item.result_count is not null then
        raise exception 'Invalid store event' using errcode = '22023';
      end if;
      select name into store_label from public.stores
        where id = item.store_id and is_published and owner_id is not null
          and lower(slug) not in ('test', 'kaubamaja');
      if not found then continue; end if;
      dedup_key := item.store_id::text || ':' || item.placement;
      if item.event_name = 'product_click' then
        if item.product_id is null or char_length(item.product_id) not between 1 and 120 then
          raise exception 'Invalid product event' using errcode = '22023';
        end if;
        select name into product_label from public.products
          where id = item.product_id and store_id = item.store_id and search_visible;
        if not found then continue; end if;
        dedup_key := dedup_key || ':' || item.product_id;
      elsif item.product_id is not null then
        raise exception 'Unexpected product' using errcode = '22023';
      end if;
    else
      if item.store_id is not null or item.product_id is not null or item.position is not null or item.placement is not null then
        raise exception 'Unexpected store data' using errcode = '22023';
      end if;
      if item.event_name = 'search' then
        if item.result_count is null or item.result_count not between 0 and 100000 then
          raise exception 'Invalid search results' using errcode = '22023';
        end if;
        dedup_key := item.id::text;
      else
        if item.result_count is not null then raise exception 'Unexpected search data' using errcode = '22023'; end if;
        dedup_key := '';
      end if;
    end if;
    insert into public.directory_analytics_events (
      id, session_id, event_name, event_key, store_id, store_name, product_id, product_name,
      placement, position, result_count, referrer_host, utm_source, device_type
    ) values (
      item.id, item.session_id, item.event_name, dedup_key, item.store_id, store_label, item.product_id, product_label,
      item.placement, item.position, item.result_count, coalesce(item.referrer_host, ''), coalesce(item.utm_source, ''), item.device_type
    ) on conflict do nothing;
    get diagnostics inserted = row_count;
    accepted := accepted + inserted;
  end loop;
  return accepted;
end;
$$;
revoke all on function public.record_directory_analytics(jsonb) from public, anon, authenticated;
grant execute on function public.record_directory_analytics(jsonb) to service_role;

-- Internal aggregation helper. Public roles cannot call it directly.
create function public.directory_analytics_metrics(range_start timestamptz, range_end timestamptz, target_store uuid)
returns jsonb language sql stable set search_path = '' as $$
  select to_jsonb(metrics) || jsonb_build_object('ctr', case when impressions > 0 then round(store_clicks * 100.0 / impressions, 1) else null end)
  from (
    select
      count(distinct session_id) filter (where target_store is not null or event_name = 'page_view') as visits,
      count(distinct (session_id, store_id)) filter (where event_name = 'store_impression') as impressions,
      count(distinct (session_id, store_id)) filter (where event_name = 'store_click') as store_clicks,
      count(distinct (session_id, store_id, product_id)) filter (where event_name = 'product_click') as product_clicks,
      count(distinct session_id) filter (where event_name in ('store_click', 'product_click')) as outbound_visits,
      count(*) filter (where event_name = 'search') as searches,
      count(*) filter (where event_name = 'search' and result_count = 0) as empty_searches,
      round(avg(position) filter (where event_name = 'store_impression' and placement = 'directory'), 1) as average_position
    from public.directory_analytics_events
    where occurred_at >= range_start and occurred_at < range_end
      and (target_store is null or store_id = target_store)
  ) metrics;
$$;
revoke all on function public.directory_analytics_metrics(timestamptz, timestamptz, uuid) from public, anon, authenticated;

create function public.admin_directory_analytics(requested_days integer default 30, requested_store_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  end_date date := (now() at time zone 'Europe/Tallinn')::date + 1;
  start_date date;
  previous_date date;
  range_start timestamptz;
  range_end timestamptz;
  previous_start timestamptz;
  tracking_start timestamptz;
  result jsonb;
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if requested_days is null or requested_days not in (7, 30, 90) then
    raise exception 'Invalid period' using errcode = '22023';
  end if;
  start_date := end_date - requested_days;
  previous_date := start_date - requested_days;
  range_start := start_date::timestamp at time zone 'Europe/Tallinn';
  range_end := end_date::timestamp at time zone 'Europe/Tallinn';
  previous_start := previous_date::timestamp at time zone 'Europe/Tallinn';
  select started_at into tracking_start from public.directory_analytics_settings where id = true;

  with
  events as materialized (
    select * from public.directory_analytics_events
    where occurred_at >= previous_start and occurred_at < range_end
      and (requested_store_id is null or store_id = requested_store_id)
  ),
  current_events as materialized (select * from events where occurred_at >= range_start),
  daily as (
    select (occurred_at at time zone 'Europe/Tallinn')::date as day,
      count(distinct session_id) filter (where requested_store_id is not null or event_name = 'page_view') as visits,
      count(distinct (session_id, store_id)) filter (where event_name = 'store_impression') as impressions,
      count(distinct (session_id, store_id)) filter (where event_name = 'store_click') as store_clicks,
      count(distinct (session_id, store_id, product_id)) filter (where event_name = 'product_click') as product_clicks
    from current_events group by 1
  ),
  first_events as (
    select distinct on (session_id) session_id, referrer_host, utm_source, device_type
    from current_events where requested_store_id is not null or event_name = 'page_view'
    order by session_id, occurred_at, id
  ),
  sources as (
    select coalesce(nullif(utm_source, ''), nullif(referrer_host, ''), 'Otse / teadmata') as label, count(*) as visits
    from first_events group by 1
  ),
  devices as (select device_type as label, count(*) as visits from first_events group by 1),
  products as (
    select product_id as id, (array_agg(product_name order by occurred_at desc))[1] as name,
      count(distinct session_id) filter (where occurred_at >= range_start) as clicks,
      count(distinct session_id) filter (where occurred_at < range_start) as previous_clicks
    from events where event_name = 'product_click' group by product_id
  ),
  placements as (
    select placement,
      count(distinct session_id) filter (where event_name = 'store_impression') as impressions,
      count(distinct session_id) filter (where event_name = 'store_click') as clicks,
      round(avg(position) filter (where event_name = 'store_impression'), 1) as average_position
    from current_events where event_name in ('store_impression', 'store_click') group by placement
  ),
  candidates as (
    select s.id, s.name, s.slug, s.is_published, o.position + 1 as position from public.stores s
    left join public.store_directory_order o on o.store_id = s.id
    where requested_store_id is null and ((s.is_published and s.owner_id is not null and lower(s.slug) not in ('test', 'kaubamaja'))
      or s.id in (select store_id from events))
    union all
    select e.store_id, (array_agg(e.store_name order by e.occurred_at desc))[1], null, false, null
    from events e where requested_store_id is null and e.store_id is not null
      and not exists (select 1 from public.stores s where s.id = e.store_id)
    group by e.store_id
  )
  select jsonb_build_object(
    'range_days', requested_days, 'from_date', start_date, 'to_date', end_date - 1,
    'previous_from_date', previous_date, 'previous_to_date', start_date - 1,
    'tracking_started_at', tracking_start, 'comparison_available', tracking_start <= previous_start,
    'store', case when requested_store_id is null then null else jsonb_build_object(
      'id', requested_store_id,
      'name', coalesce((select name from public.stores where id = requested_store_id),
        (select store_name from events order by occurred_at desc limit 1), 'Kustutatud pood')
    ) end,
    'current', public.directory_analytics_metrics(range_start, range_end, requested_store_id),
    'previous', public.directory_analytics_metrics(previous_start, range_start, requested_store_id),
    'daily', (select jsonb_agg(jsonb_build_object(
      'date', days.day::date, 'visits', coalesce(d.visits, 0), 'impressions', coalesce(d.impressions, 0),
      'store_clicks', coalesce(d.store_clicks, 0), 'product_clicks', coalesce(d.product_clicks, 0)
    ) order by days.day) from generate_series(start_date::timestamp, (end_date - 1)::timestamp, interval '1 day') days(day)
      left join daily d on d.day = days.day::date),
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by visits desc, label) from sources s), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(to_jsonb(d) order by visits desc, label) from devices d), '[]'::jsonb),
    'stores', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'current', public.directory_analytics_metrics(range_start, range_end, c.id),
      'previous', public.directory_analytics_metrics(previous_start, range_start, c.id)
    ) order by c.position nulls last, c.name, c.id) from candidates c), '[]'::jsonb),
    'products', case when requested_store_id is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(p))
      from (select * from products order by clicks desc, name limit 20) p), '[]'::jsonb) end,
    'placements', case when requested_store_id is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(p) order by placement) from placements p), '[]'::jsonb) end
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_directory_analytics(integer, uuid) from public, anon;
grant execute on function public.admin_directory_analytics(integer, uuid) to authenticated;

-- Two 90-day calendar periods, plus the current partial day.
select cron.schedule('poeruum-directory-analytics-retention', '20 3 * * *',
  $$delete from public.directory_analytics_events
    where occurred_at < (((now() at time zone 'Europe/Tallinn')::date - 180)::timestamp at time zone 'Europe/Tallinn');$$);
