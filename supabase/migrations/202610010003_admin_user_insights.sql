-- Per-user drilldown; only fetched when an administrator opens a row.
create function public.admin_user_insights(target_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  target_store_id uuid;
  result jsonb;
  window_start timestamptz := now() - interval '30 days';
begin
  if coalesce((select auth.jwt()->'app_metadata'->>'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not exists (select from auth.users u where u.id=target_user_id and coalesce(u.raw_app_meta_data->>'role','')<>'admin') then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  select s.id into target_store_id from public.stores s where s.owner_id=target_user_id;

  with recent_orders as materialized (
    select o.*, greatest(0, round(o.total*100)::bigint - case when o.payment_status='refunded'
      then round(o.total*100)::bigint else o.stripe_refunded_amount_cents end) as net_cents
    from public.orders o where o.store_id=target_store_id and o.stripe_mode='live' and o.created_at>=window_start
  ), daily as (
    select (o.created_at at time zone 'Europe/Tallinn')::date as day,
      count(*) filter(where o.payment_status='paid')::integer as orders,
      sum(o.net_cents)::bigint as net_cents
    from recent_orders o where o.payment_status in ('paid','refunded') and o.stripe_payment_intent_id is not null
    group by 1
  ), days as (
    select (window_start at time zone 'Europe/Tallinn')::date+n as day
    from generate_series(0, (now() at time zone 'Europe/Tallinn')::date-(window_start at time zone 'Europe/Tallinn')::date) n
  )
  select jsonb_build_object(
    'detail_version',1,'user_id',target_user_id,'generated_at',now(),
    'sales_days', (select jsonb_agg(jsonb_build_object('day',days.day,'orders',coalesce(d.orders,0),'net_cents',coalesce(d.net_cents,0)) order by days.day) from days left join daily d using(day)),
    'order_states', (select jsonb_build_object(
      'paid',count(*) filter(where payment_status='paid' and stripe_payment_intent_id is not null),
      'pending',count(*) filter(where payment_status='pending'),
      'failed',count(*) filter(where payment_status='failed'),
      'refunded',count(*) filter(where payment_status='refunded' and stripe_payment_intent_id is not null)
    ) from recent_orders),
    'first_paid_order_at', (select min(o.created_at) from public.orders o where o.store_id=target_store_id and o.stripe_mode='live' and o.payment_status='paid' and o.stripe_payment_intent_id is not null),
    'first_product_at',(select min(p.created_at) from public.products p where p.store_id=target_store_id),
    'last_product_at',(select max(p.created_at) from public.products p where p.store_id=target_store_id),
    'products_added_30d',(select count(*) from public.products p where p.store_id=target_store_id and p.created_at>=window_start),
    'payments',(select jsonb_build_object('live',s.stripe_account_mode='live','charges_enabled',s.stripe_account_charges_enabled,'payouts_enabled',s.stripe_account_payouts_enabled) from public.stores s where s.id=target_store_id),
    'support_resolved',(select count(*) from public.support_conversations sc where sc.user_id=target_user_id and sc.status='resolved')
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_user_insights(uuid) from public, anon;
grant execute on function public.admin_user_insights(uuid) to authenticated;
comment on function public.admin_user_insights(uuid) is
  'Admin-only row drilldown. Sales use the same rolling created-order cohort as admin_user_overview, grouped by Tallinn calendar date. Milestones are recorded facts, not inferred activity.';
