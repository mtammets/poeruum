create table public.store_analytics_settings (
  id boolean primary key default true check (id),
  started_at timestamptz not null default now()
);
insert into public.store_analytics_settings (id) values (true);
create table public.store_analytics_events (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  session_id uuid not null,
  event_name text not null check (event_name in ('visit', 'product_view')),
  product_id text not null default '',
  product_name text,
  source text not null check (source in ('Kaubamaja','Google','Instagram','Facebook','TikTok','Muud viitajad','Otse / teadmata')),
  occurred_at timestamptz not null default now(),
  check ((event_name = 'visit' and product_id = '') or (event_name = 'product_view' and char_length(product_id) between 1 and 120)),
  unique (store_id, session_id, event_name, product_id)
);
create index store_analytics_events_store_time_idx on public.store_analytics_events (store_id, occurred_at);
create index store_analytics_events_time_idx on public.store_analytics_events (occurred_at);
create index orders_store_analytics_paid_idx on public.orders (store_id, (coalesce(invoice_paid_at, created_at)))
  where stripe_mode = 'live' and payment_status in ('paid', 'refunded') and stripe_payment_intent_id is not null;
alter table public.store_analytics_events enable row level security;
alter table public.store_analytics_settings enable row level security;
revoke all on public.store_analytics_events, public.store_analytics_settings from public, anon, authenticated;

create function public.record_store_analytics(target_store_id uuid, origin_hostname text, events jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item record;
  product_label text;
  added integer;
  accepted integer := 0;
begin
  if not exists (
    select 1 from public.stores s where s.id = target_store_id and s.is_published and s.owner_id is not null
      and s.slug not in ('test', 'kaubamaja')
      and (origin_hostname = s.slug || '.poeruum.ee' or exists (
        select 1 from public.custom_domains d where d.store_id = s.id and d.status = 'active'
          and origin_hostname in (d.hostname, d.redirect_hostname)
      ))
  ) then raise exception 'Store origin not allowed' using errcode = '42501'; end if;
  if events is null or jsonb_typeof(events) <> 'array' then
    raise exception 'Invalid events' using errcode = '22023';
  end if;
  if jsonb_array_length(events) not between 1 and 20 then raise exception 'Invalid batch' using errcode = '22023'; end if;
  for item in select * from jsonb_to_recordset(events) as e(id uuid, session_id uuid, event_name text, product_id text, source text) loop
    if item.id is null or item.session_id is null or item.event_name is null or item.event_name not in ('visit','product_view')
      or item.source is null or item.source not in ('Kaubamaja','Google','Instagram','Facebook','TikTok','Muud viitajad','Otse / teadmata')
      or item.product_id is null then raise exception 'Invalid event' using errcode = '22023'; end if;
    product_label := null;
    if item.event_name = 'product_view' then
      if char_length(item.product_id) not between 1 and 120 then raise exception 'Invalid product' using errcode = '22023'; end if;
      select name into product_label from public.products where id = item.product_id and store_id = target_store_id;
      if not found then continue; end if;
    elsif item.product_id <> '' then raise exception 'Unexpected product' using errcode = '22023'; end if;
    insert into public.store_analytics_events (id, store_id, session_id, event_name, product_id, product_name, source)
    values (item.id, target_store_id, item.session_id, item.event_name, item.product_id, product_label, item.source)
    on conflict do nothing;
    get diagnostics added = row_count;
    accepted := accepted + added;
  end loop;
  return accepted;
end;
$$;
revoke all on function public.record_store_analytics(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_store_analytics(uuid, text, jsonb) to service_role;

create function public.merchant_store_analytics(target_store_id uuid, requested_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  end_date date := (now() at time zone 'Europe/Tallinn')::date;
  start_date date;
  range_start timestamptz;
  previous_start timestamptz;
  previous_end timestamptz;
  tracking_start timestamptz;
  store_created timestamptz;
  result jsonb;
begin
  select created_at into store_created from public.stores where id = target_store_id and owner_id = (select auth.uid());
  if not found then raise exception 'Store access required' using errcode = '42501'; end if;
  if requested_days is null or requested_days not in (7,30) then raise exception 'Invalid period' using errcode = '22023'; end if;
  start_date := end_date - requested_days + 1;
  range_start := start_date::timestamp at time zone 'Europe/Tallinn';
  previous_start := (start_date - requested_days)::timestamp at time zone 'Europe/Tallinn';
  -- Compare through the same local time, including across daylight-saving changes.
  previous_end := ((now() at time zone 'Europe/Tallinn') - make_interval(days => requested_days)) at time zone 'Europe/Tallinn';
  select greatest(started_at, store_created) into tracking_start from public.store_analytics_settings where id;
  with events as materialized (
    select * from public.store_analytics_events where store_id = target_store_id and occurred_at >= previous_start and occurred_at <= now()
  ), payments as materialized (
    select coalesce(invoice_paid_at, created_at) as paid_at, payment_status,
      case when payment_status = 'refunded' then 0
        else greatest(0, total - coalesce(stripe_refunded_amount_cents, 0) / 100.0) end as sales
    from public.orders where store_id = target_store_id and stripe_mode = 'live'
      and stripe_payment_intent_id is not null and payment_status in ('paid','refunded')
      and coalesce(invoice_paid_at, created_at) >= previous_start and coalesce(invoice_paid_at, created_at) <= now()
  ), periods as (
    select 'current' as label, range_start as begins, now() as ends
    union all select 'previous', previous_start, previous_end
  ), totals as (
    select p.label, jsonb_build_object(
      'visits', (select count(*) from events e where e.event_name='visit' and e.occurred_at >= p.begins and e.occurred_at <= p.ends),
      'orders', (select count(*) from payments o where o.payment_status='paid' and o.paid_at >= p.begins and o.paid_at <= p.ends),
      'sales', (select coalesce(sum(o.sales),0) from payments o where o.paid_at >= p.begins and o.paid_at <= p.ends)
    ) as metrics from periods p
  ), days as (
    select d::date as day from generate_series(start_date::timestamp, end_date::timestamp, interval '1 day') d
  ), event_days as (
    select (occurred_at at time zone 'Europe/Tallinn')::date as day, count(*) as visits
    from events where occurred_at >= range_start and event_name='visit' group by 1
  ), payment_days as (
    select (paid_at at time zone 'Europe/Tallinn')::date as day,
      count(*) filter (where payment_status='paid') as orders, sum(sales) as sales
    from payments where paid_at >= range_start group by 1
  ), product_totals as (
    select e.product_id, max(e.product_name) as name, count(*) as views
    from events e where e.occurred_at >= range_start and e.event_name='product_view'
    group by e.product_id order by views desc, e.product_id limit 8
  ), product_days as (
    select product_id, (occurred_at at time zone 'Europe/Tallinn')::date as day, count(*) as views
    from events where occurred_at >= range_start and event_name='product_view' group by 1,2
  ), sources as (
    select source as label, count(*) as visits from events where occurred_at >= range_start and event_name='visit'
    group by source order by visits desc, source
  ) select jsonb_build_object(
    'store_id', target_store_id, 'range_days', requested_days, 'from_date', start_date, 'to_date', end_date,
    'updated_at', now(), 'tracking_started_at', tracking_start, 'comparison_available', tracking_start <= previous_start,
    'current', (select metrics from totals where label='current'), 'previous', (select metrics from totals where label='previous'),
    'daily', (select jsonb_agg(jsonb_build_object('date', d.day,
      'visits', case when d.day < (tracking_start at time zone 'Europe/Tallinn')::date then null else coalesce(e.visits,0) end,
      'orders', coalesce(o.orders,0), 'sales', coalesce(o.sales,0)) order by d.day)
      from days d left join event_days e using (day) left join payment_days o using (day)),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', t.product_id, 'name', coalesce(p.name,t.name),
      'image', p.image_url, 'views', t.views,
      'daily', (select jsonb_agg(jsonb_build_object('date', d.day, 'views',
        case when d.day < (tracking_start at time zone 'Europe/Tallinn')::date then null else coalesce(v.views,0) end) order by d.day)
        from days d left join product_days v on v.day=d.day and v.product_id=t.product_id)
    ) order by t.views desc, t.product_id) from product_totals t left join public.products p on p.id=t.product_id and p.store_id=target_store_id), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.visits desc, s.label) from sources s), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.merchant_store_analytics(uuid, integer) from public, anon;
grant execute on function public.merchant_store_analytics(uuid, integer) to authenticated;

select cron.schedule('poeruum-store-analytics-retention', '25 3 * * *',
  $$delete from public.store_analytics_events
    where occurred_at < (((now() at time zone 'Europe/Tallinn')::date - 180)::timestamp at time zone 'Europe/Tallinn')
      or store_id in (select id from public.stores where owner_id is null);$$);
