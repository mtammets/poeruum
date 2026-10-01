-- Read-only operational metrics. Legacy dashboard totals remain unchanged.
create or replace function public.admin_user_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', u.id,
    'metrics_version', 1,
    'payment_state', case
      when s.id is null or s.stripe_account_id is null or s.payment_provider <> 'stripe' then 'not_connected'
      when s.stripe_account_mode = 'test' then 'test'
      when s.stripe_account_mode is null then 'unknown'
      when s.payment_status = 'connected' and s.stripe_account_charges_enabled and s.stripe_account_payouts_enabled
        and c.stripe_ready and c.identity_error is null then 'active'
      when c.identity_error is not null or jsonb_array_length(coalesce(s.stripe_account_requirement_issues, '[]'::jsonb)) > 0
        or (s.payment_status = 'connected' and (not s.stripe_account_charges_enabled or not s.stripe_account_payouts_enabled)) then 'restricted'
      when c.store_id is null then 'unknown'
      else 'pending' end,
    'payment_checked_at', c.checked_at,
    'paid_orders_30d', sales.paid_orders_30d,
    'net_sales_30d_cents', sales.net_sales_30d_cents,
    'paid_orders_total', sales.paid_orders_total,
    'last_paid_order_at', sales.last_paid_order_at,
    'awaiting_admin_count', support.awaiting_admin_count,
    'waiting_user_count', support.waiting_user_count,
    'awaiting_admin_conversation_id', support.awaiting_admin_conversation_id
  )), '[]'::jsonb) into result
  from auth.users u
  left join public.stores s on s.owner_id = u.id
  left join public.store_payment_checks c on c.store_id = s.id
    and c.account_id = s.stripe_account_id and c.stripe_mode = s.stripe_account_mode
    and c.identity = public.seller_identity_key(s.settings)
  left join lateral (
    -- A rolling cohort of orders CREATED within 30 days. Include only live,
    -- confirmed payments. Full/partial refunds reduce receipts, never invent sales.
    select
      count(*) filter (where o.payment_status = 'paid' and o.created_at >= now() - interval '30 days')::integer as paid_orders_30d,
      coalesce(sum(greatest(0, round(o.total * 100)::bigint - case
        when o.payment_status = 'refunded' then round(o.total * 100)::bigint
        else o.stripe_refunded_amount_cents end)) filter (where o.created_at >= now() - interval '30 days'), 0)::bigint as net_sales_30d_cents,
      count(*) filter (where o.payment_status = 'paid')::integer as paid_orders_total,
      max(o.created_at) filter (where o.payment_status = 'paid') as last_paid_order_at
    from public.orders o
    where o.store_id = s.id and o.stripe_mode = 'live'
      and o.payment_status in ('paid', 'refunded') and o.stripe_payment_intent_id is not null
  ) sales on true
  left join lateral (
    select count(*) filter (where sc.status = 'open')::integer as awaiting_admin_count,
      count(*) filter (where sc.status = 'waiting_user')::integer as waiting_user_count,
      (array_agg(sc.id order by sc.last_message_at) filter (where sc.status = 'open'))[1] as awaiting_admin_conversation_id
    from public.support_conversations sc where sc.user_id = u.id
  ) support on true
  where coalesce(u.raw_app_meta_data ->> 'role', '') <> 'admin';
  return result;
end;
$$;
revoke all on function public.admin_user_overview() from public, anon;
grant execute on function public.admin_user_overview() to authenticated;
comment on function public.admin_user_overview() is
  'Admin-only live paid-order cohorts (created in last 30 days), net receipts including delivery minus refunds, recorded Stripe state and actionable support counts. Does not infer user activity from store updates.';

create trigger signal_admin_dashboard_after_payment_checks
after insert or update or delete on public.store_payment_checks
for each statement execute function public.signal_admin_dashboard_refresh();

-- Record only the coarse application view, never field contents or URLs.
-- Keep the legacy heartbeat callable while older clients are still open.
alter table public.user_presence_sessions add column current_view text
  check (current_view in ('landing','login','forgot-password','reset-password','account','store','payments','shipping','business','product','publish','storefront'));
create function public.touch_user_presence_view(target_session_id uuid, current_view_value text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if current_view_value is null or current_view_value not in ('landing','login','forgot-password','reset-password','account','store','payments','shipping','business','product','publish','storefront') then
    raise exception 'Invalid presence view' using errcode='22023';
  end if;
  perform public.touch_user_presence(target_session_id);
  update public.user_presence_sessions set current_view=current_view_value
  where session_id=target_session_id and user_id=(select auth.uid());
end;
$$;
revoke all on function public.touch_user_presence_view(uuid,text) from public,anon;
grant execute on function public.touch_user_presence_view(uuid,text) to authenticated;

create function public.admin_user_presence()
returns table(user_id uuid,current_view text,last_seen_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce((select auth.jwt()->'app_metadata'->>'role'),'') <> 'admin' then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  return query select distinct on (p.user_id) p.user_id,p.current_view,p.last_seen_at
  from public.user_presence_sessions p
  where p.last_seen_at>=now()-interval '95 seconds'
  order by p.user_id,p.last_seen_at desc,p.session_id;
end;
$$;
revoke all on function public.admin_user_presence() from public,anon;
grant execute on function public.admin_user_presence() to authenticated;
