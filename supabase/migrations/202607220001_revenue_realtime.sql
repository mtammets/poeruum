create table public.revenue_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'montonio')),
  provider_event_id text not null,
  provider_object_id text,
  store_id uuid references public.stores(id) on delete set null,
  kind text not null check (kind in ('subscription', 'transaction_fee', 'transaction_fee_refund')),
  amount_cents integer not null check (amount_cents <> 0),
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  description text not null,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index revenue_events_occurred_at_idx on public.revenue_events(occurred_at desc);
create index revenue_events_store_id_idx on public.revenue_events(store_id);
create index revenue_events_provider_object_id_idx on public.revenue_events(provider, provider_object_id)
  where provider_object_id is not null;

alter table public.revenue_events enable row level security;
revoke all on table public.revenue_events from public, anon, authenticated;
grant select on table public.revenue_events to authenticated;
grant select, insert, update, delete on table public.revenue_events to service_role;

create policy "Admins read revenue events" on public.revenue_events
for select to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin');

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'revenue_events'
  ) then
    alter publication supabase_realtime add table public.revenue_events;
  end if;
end $$;

create or replace function public.admin_revenue_dashboard()
returns table (
  month_total_cents bigint,
  today_total_cents bigint,
  subscription_total_cents bigint,
  transaction_fee_total_cents bigint,
  refund_total_cents bigint,
  recent_events jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  with month_events as (
    select event.*
    from public.revenue_events as event
    where (event.occurred_at at time zone 'Europe/Tallinn')::date
      >= date_trunc('month', now() at time zone 'Europe/Tallinn')::date
  ), recent as (
    select jsonb_agg(to_jsonb(item) order by item.occurred_at desc) as events
    from (
      select
        event.id,
        event.kind,
        event.amount_cents,
        event.currency,
        event.description,
        event.occurred_at,
        event.store_id,
        coalesce(store.name, 'Tundmatu pood') as store_name
      from public.revenue_events as event
      left join public.stores as store on store.id = event.store_id
      order by event.occurred_at desc
      limit 8
    ) as item
  )
  select
    coalesce(sum(event.amount_cents), 0)::bigint,
    coalesce(sum(event.amount_cents) filter (
      where (event.occurred_at at time zone 'Europe/Tallinn')::date = (now() at time zone 'Europe/Tallinn')::date
    ), 0)::bigint,
    coalesce(sum(event.amount_cents) filter (where event.kind = 'subscription'), 0)::bigint,
    coalesce(sum(event.amount_cents) filter (where event.kind = 'transaction_fee'), 0)::bigint,
    coalesce(sum(event.amount_cents) filter (where event.kind = 'transaction_fee_refund'), 0)::bigint,
    coalesce((select recent.events from recent), '[]'::jsonb)
  from month_events as event;
end;
$$;

revoke all on function public.admin_revenue_dashboard() from public, anon;
grant execute on function public.admin_revenue_dashboard() to authenticated;

alter table public.orders
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded')),
  add column if not exists stripe_checkout_session_id text unique,
  add column if not exists stripe_payment_intent_id text;

create or replace function public.complete_stripe_order(
  target_order_id uuid,
  checkout_session_id text,
  payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  order_item jsonb;
  item_quantity integer;
begin
  select * into target
  from public.orders
  where id = target_order_id
  for update;

  if not found or target.payment_status = 'paid' then return; end if;

  update public.orders
  set payment_status = 'paid',
      stripe_checkout_session_id = checkout_session_id,
      stripe_payment_intent_id = payment_intent_id
  where id = target_order_id;

  for order_item in select * from jsonb_array_elements(target.items)
  loop
    item_quantity := greatest(1, coalesce((order_item ->> 'quantity')::integer, 1));
    update public.products
    set stock = greatest(0, stock - item_quantity)
    where store_id = target.store_id
      and id = order_item ->> 'id'
      and stock is not null;
  end loop;
end;
$$;

revoke all on function public.complete_stripe_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_stripe_order(uuid, text, text) to service_role;
