-- This campaign's clock is fixed: 4 November 2026, 06:00 Europe/Tallinn.
-- This does not change the public campaign's display schedule.
create table public.woodpecker_analytics_settings (
  id boolean primary key default true check (id),
  starts_at timestamptz not null default '2026-11-04 06:00:00 Europe/Tallinn',
  tracking_started_at timestamptz not null default now()
);
insert into public.woodpecker_analytics_settings (id) values (true);
create table public.woodpecker_analytics_events (
  id uuid primary key,
  visitor_id uuid not null,
  session_id uuid not null,
  surface text not null check (surface in ('directory','homepage','store')),
  event_name text not null check (event_name in ('visit','engagement','scroll','shop_click','homepage_click','product_view','product_click','add_to_cart','checkout_start','checkout_redirect','checkout_error','bird_call','game_view','game_start','game_progress','game_end')),
  source text not null check (source in ('Kaubamaja','Krük Krüki koduleht','Krük Krüki e-pood','Google','Instagram','Facebook','TikTok','Muud viitajad','Otse / teadmata')),
  device text not null check (device in ('mobile','tablet','desktop')),
  utm_campaign text not null default '' check (utm_campaign ~ '^[a-z0-9_.-]{0,80}$'),
  product_id text not null default '' check (char_length(product_id) <= 120),
  placement text not null default '' check (placement ~ '^[a-z_]{0,30}$'),
  game_id uuid,
  value integer not null default 0 check (value between 0 and 100000),
  duration integer not null default 0 check (duration between 0 and 86400),
  occurred_at timestamptz not null default now(),
  check ((event_name like 'game_%' and game_id is not null and surface = 'directory') or (event_name not like 'game_%' and game_id is null)),
  check (event_name <> 'scroll' or value in (25,50,75,100))
);
create index woodpecker_events_time on public.woodpecker_analytics_events(occurred_at);
create index woodpecker_events_session on public.woodpecker_analytics_events(session_id, visitor_id, occurred_at);
create index woodpecker_events_visitor on public.woodpecker_analytics_events(visitor_id, occurred_at);
create unique index woodpecker_visits_unique on public.woodpecker_analytics_events(session_id, surface) where event_name = 'visit';
create unique index woodpecker_game_start_unique on public.woodpecker_analytics_events(game_id) where event_name = 'game_start';
create table public.woodpecker_order_attribution (
  order_id uuid primary key references public.orders(id) on delete cascade,
  visitor_id uuid not null,
  session_id uuid not null,
  surface text not null,
  created_at timestamptz not null default now()
);
alter table public.woodpecker_analytics_settings enable row level security;
alter table public.woodpecker_analytics_events enable row level security;
alter table public.woodpecker_order_attribution enable row level security;
revoke all on public.woodpecker_analytics_settings, public.woodpecker_analytics_events, public.woodpecker_order_attribution from public, anon, authenticated;

create function public.record_woodpecker_analytics(origin_hostname text, events jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  allowed_surface text;
  campaign_start timestamptz;
  campaign_end timestamptz;
  added integer;
begin
  allowed_surface := case origin_hostname when 'kaubamaja.poeruum.ee' then 'directory'
    when 'kruk-kruk.ee' then 'homepage' when 'www.kruk-kruk.ee' then 'homepage' when 'kruk-kruk.poeruum.ee' then 'store' end;
  if allowed_surface is null then raise exception 'Origin not allowed' using errcode = '42501'; end if;
  select starts_at into campaign_start from public.woodpecker_analytics_settings where id;
  select ends_at into campaign_end from public.directory_campaign_settings where id = 'black-friday' and ends_at > campaign_start;
  if now() < campaign_start or now() >= campaign_end then return 0; end if;
  if events is null or jsonb_typeof(events) <> 'array' then raise exception 'Invalid events' using errcode = '22023'; end if;
  if jsonb_array_length(events) not between 1 and 20 then raise exception 'Invalid batch' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(events) e where e->>'surface' is distinct from allowed_surface) then
    raise exception 'Surface not allowed' using errcode = '42501'; end if;
  insert into public.woodpecker_analytics_events (id, visitor_id, session_id, surface, event_name, source, device, utm_campaign, product_id, placement, game_id, value, duration)
    select e.id, e.visitor_id, e.session_id, e.surface, e.event_name, e.source, e.device, e.utm_campaign, e.product_id, e.placement, e.game_id, e.value, e.duration
    from jsonb_to_recordset(events) e(id uuid, visitor_id uuid, session_id uuid, surface text, event_name text, source text, device text, utm_campaign text, product_id text, placement text, game_id uuid, value integer, duration integer)
    on conflict do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;
revoke all on function public.record_woodpecker_analytics(text,jsonb) from public, anon, authenticated;
grant execute on function public.record_woodpecker_analytics(text,jsonb) to service_role;

-- Called by checkout after a real order exists, never by a public browser RPC.
-- An attribution failure cannot block payment. First attribution wins on retries.
create function public.attribute_woodpecker_order(target_order_id uuid, target_visitor_id uuid, target_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.woodpecker_order_attribution(order_id, visitor_id, session_id, surface)
    select o.id, e.visitor_id, e.session_id, e.surface
    from public.orders o join public.stores s on s.id=o.store_id
    cross join lateral (select visitor_id, session_id, surface from public.woodpecker_analytics_events
      where visitor_id=target_visitor_id and session_id=target_session_id and surface in ('directory','store')
        and occurred_at >= now() - interval '24 hours' order by occurred_at desc limit 1) e
    where o.id=target_order_id and s.slug='kruk-kruk' and o.stripe_mode='live'
      and o.created_at >= (select starts_at from public.woodpecker_analytics_settings where id)
    on conflict do nothing;
end;
$$;
revoke all on function public.attribute_woodpecker_order(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.attribute_woodpecker_order(uuid,uuid,uuid) to service_role;

create function public.admin_woodpecker_analytics(requested_range text default 'all', player_page integer default 0, player_search text default '', as_of timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  campaign_start timestamptz;
  campaign_end timestamptz;
  tracking_start timestamptz;
  range_start timestamptz;
  range_end timestamptz;
  report_now timestamptz;
  bucket text;
  result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if requested_range is null or requested_range not in ('all','today','24h','7d') or player_page is null or player_page < 0 or player_page > 100000
    or player_search is null or char_length(player_search)>100 or (as_of is not null and not isfinite(as_of)) then raise exception 'Invalid range' using errcode='22023'; end if;
  select starts_at, tracking_started_at into campaign_start, tracking_start from public.woodpecker_analytics_settings where id;
  select ends_at into campaign_end from public.directory_campaign_settings where id='black-friday' and ends_at>campaign_start;
  report_now := least(coalesce(as_of, now()), now());
  range_end := least(report_now, coalesce(campaign_end, report_now));
  range_start := greatest(campaign_start, case requested_range when 'today' then date_trunc('day', report_now at time zone 'Europe/Tallinn') at time zone 'Europe/Tallinn'
    when '24h' then report_now-interval '24 hours' when '7d' then report_now-interval '7 days' else campaign_start end);
  bucket := case when range_end-range_start <= interval '48 hours' then 'hour' else 'day' end;
  with e as materialized (
    select * from public.woodpecker_analytics_events where occurred_at>=range_start and occurred_at<range_end
  ), sessions as (
    select surface, session_id, max(duration) filter(where event_name='engagement') as seconds
    from e group by surface, session_id
  ), games as materialized (
    select game_id, visitor_id, max(value) as hats, max(duration) as seconds,
      min(occurred_at) filter(where event_name='game_start') as started_at, max(occurred_at) as last_seen,
      (array_agg(device order by occurred_at))[1] as device, (array_agg(source order by occurred_at))[1] as source
    from e where event_name in ('game_start','game_progress','game_end') group by game_id, visitor_id
    having bool_or(event_name='game_start')
  ), payments as materialized (
    select o.*, coalesce(o.invoice_paid_at,o.created_at) as paid_at,
      case when o.payment_status='refunded' then 0 else greatest(0,o.total-coalesce(o.stripe_refunded_amount_cents,0)/100.0) end as net_sales,
      a.visitor_id, a.surface as origin_surface
    from public.orders o join public.stores s on s.id=o.store_id
    left join public.woodpecker_order_attribution a on a.order_id=o.id
    where s.slug='kruk-kruk' and o.stripe_mode='live' and o.stripe_payment_intent_id is not null
      and o.payment_status in ('paid','refunded') and coalesce(o.invoice_paid_at,o.created_at)>=range_start and coalesce(o.invoice_paid_at,o.created_at)<range_end
  ), player_payments as (
    select visitor_id, count(*) filter(where payment_status='paid') as orders, sum(net_sales) as sales,
      (array_agg(customer_name order by paid_at desc) filter(where payment_status='paid'))[1] as customer_name
    from payments p where visitor_id is not null
      and exists (select 1 from games g where g.visitor_id=p.visitor_id and g.started_at<=p.paid_at) group by visitor_id
  ), players as materialized (
    select g.visitor_id, count(*) as games, sum(g.hats) as hats, max(g.hats) as best, sum(g.seconds) as seconds,
      max(g.last_seen) as last_seen, (array_agg(g.device order by g.last_seen desc))[1] as device,
      (array_agg(g.source order by g.started_at))[1] as source,
      coalesce(p.orders,0) as orders, coalesce(p.sales,0) as sales, p.customer_name
    from games g left join player_payments p using(visitor_id) group by g.visitor_id,p.orders,p.sales,p.customer_name
  ), filtered_players as (
    select * from players where player_search='' or position(lower(player_search) in lower(coalesce(customer_name,'') || ' ' || visitor_id::text))>0
  ), surfaces as (
    select s.surface, count(distinct e.session_id) as visits, count(distinct e.visitor_id) as visitors,
      count(*) filter(where e.event_name in ('shop_click','product_click','homepage_click')) as clicks,
      count(*) filter(where e.event_name='product_view') as product_views,
      count(distinct e.session_id) filter(where e.event_name='checkout_start') as checkouts,
      count(distinct e.session_id) filter(where e.event_name='scroll' and e.value=100) as full_scrolls,
      coalesce((select round(avg(coalesce(seconds,0))) from sessions x where x.surface=s.surface),0) as seconds
    from unnest(array['directory','homepage','store']) s(surface) left join e using(surface) group by s.surface
  ), ticks as (
    select t as time from generate_series(date_trunc(bucket,range_start at time zone 'Europe/Tallinn') at time zone 'Europe/Tallinn',range_end,
      case when bucket='hour' then interval '1 hour' else interval '1 day' end) t where range_start<=range_end
  ), traffic as (
    select date_trunc(bucket,occurred_at at time zone 'Europe/Tallinn') at time zone 'Europe/Tallinn' as time, surface, count(*) as visits
    from e where event_name='visit' group by 1,2
  ), timeline as (
    select t.time, coalesce(sum(v.visits) filter(where v.surface='directory'),0) as directory,
      coalesce(sum(v.visits) filter(where v.surface='homepage'),0) as homepage,
      coalesce(sum(v.visits) filter(where v.surface='store'),0) as store,
      t.time + case when bucket='hour' then interval '1 hour' else interval '1 day' end > tracking_start as measured
    from ticks t left join traffic v using(time) group by t.time
  ), sources as (
    select source as label, count(*) as visits from e where event_name='visit' group by source order by visits desc
  ), devices as (
    select device as label, count(*) as visits from e where event_name='visit' group by device order by visits desc
  ), actions as (
    select event_name as label, count(*) as events, count(distinct session_id) as sessions from e group by event_name
    union all select 'product_interest', count(*), count(distinct session_id) from e where event_name in ('product_view','product_click')
  ), products as (
    select e.product_id, max(p.name) as name, max(p.image_url) as image,
      count(*) filter(where event_name='product_view') as views,
      count(*) filter(where event_name='add_to_cart') as carts,
      count(*) filter(where event_name='product_click') as clicks
    from e left join public.products p on p.id=e.product_id
    where e.product_id<>'' group by e.product_id order by views desc, clicks desc limit 12
  ), utms as (
    select source, utm_campaign as campaign, count(*) as visits from e where event_name='visit' and utm_campaign<>''
    group by source,utm_campaign order by visits desc limit 20
  ) select jsonb_build_object(
    'starts_at',campaign_start,'ends_at',campaign_end,'tracking_started_at',tracking_start,'from',range_start,'to',range_end,'updated_at',now(),'bucket',bucket,
    'totals',jsonb_build_object('visits',(select count(*) from e where event_name='visit'),
      'players',(select count(*) from players),'games',(select count(*) from games),'hats',(select coalesce(sum(hats),0) from games),
      'best',(select coalesce(max(hats),0) from games),'game_seconds',(select coalesce(round(avg(seconds)),0) from games),
      'game_buyers',(select count(*) from players where orders>0),'orders',(select count(*) from payments where payment_status='paid'),
      'sales',(select coalesce(sum(net_sales),0) from payments),'attributed_orders',(select count(*) from payments where payment_status='paid' and visitor_id is not null),
      'refunds',(select coalesce(sum(total-net_sales),0) from payments),
      'active',(select count(distinct session_id) from e where occurred_at>=now()-interval '5 minutes')),
    'surfaces',(select jsonb_agg(to_jsonb(s) order by surface) from surfaces s),
    'timeline',coalesce((select jsonb_agg(to_jsonb(t) order by time) from timeline t),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by visits desc) from sources s),'[]'::jsonb),
    'devices',coalesce((select jsonb_agg(to_jsonb(d) order by visits desc) from devices d),'[]'::jsonb),
    'actions',coalesce((select jsonb_agg(to_jsonb(a)) from actions a),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(to_jsonb(p)) from products p),'[]'::jsonb),
    'utms',coalesce((select jsonb_agg(to_jsonb(u)) from utms u),'[]'::jsonb),
    'players',coalesce((select jsonb_agg(to_jsonb(p) order by last_seen desc,visitor_id) from
      (select * from filtered_players order by last_seen desc,visitor_id limit 25 offset player_page*25) p),'[]'::jsonb),
    'player_count',(select count(*) from filtered_players),'player_page',player_page
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_woodpecker_analytics(text,integer,text,timestamptz) from public, anon;
grant execute on function public.admin_woodpecker_analytics(text,integer,text,timestamptz) to authenticated;
select cron.schedule('poeruum-woodpecker-analytics-retention','35 3 * * *',
  $$delete from public.woodpecker_analytics_events where occurred_at < now()-interval '180 days';
    delete from public.woodpecker_order_attribution where created_at < now()-interval '180 days';$$);
