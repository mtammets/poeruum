-- Administrative accounts are platform operators, not merchants. Keep them out
-- of merchant dashboards, setup metrics, presence and reminder automation even
-- when the admin role is assigned after the auth user was created.

create or replace function public.admin_dashboard_users()
returns table (
  user_id uuid,
  email text,
  user_created_at timestamptz,
  last_sign_in_at timestamptz,
  store_id uuid,
  store_name text,
  store_slug text,
  store_created_at timestamptz,
  is_published boolean,
  payment_status text,
  pricing_plan text,
  product_count bigint,
  order_count bigint,
  gross_sales numeric,
  last_activity_at timestamptz,
  has_store_details boolean,
  has_payments boolean,
  has_delivery boolean,
  has_product boolean,
  has_business_details boolean,
  has_published boolean,
  open_support_count bigint,
  last_support_at timestamptz
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
  select users.id, users.email::text, users.created_at, users.last_sign_in_at,
    store.id, store.name, store.slug, store.created_at, coalesce(store.is_published, false),
    coalesce(store.payment_status, 'idle'), coalesce(store.pricing_plan, 'flexible'),
    coalesce(products.product_count, 0), coalesce(orders.order_count, 0), coalesce(orders.gross_sales, 0),
    greatest(users.last_sign_in_at, store.updated_at, products.last_updated_at, orders.last_created_at),
    coalesce(nullif(btrim(store.name), '') is not null, false),
    coalesce(store.payment_status = 'connected', false),
    coalesce(cardinality(store.shipping) > 0, false),
    coalesce(products.product_count > 0, false),
    coalesce(nullif(btrim(store.settings ->> 'businessName'), '') is not null
      and (store.settings ->> 'registryCode') ~ '^\d{8}$'
      and nullif(btrim(store.settings ->> 'businessAddress'), '') is not null
      and nullif(btrim(store.settings ->> 'contactEmail'), '') is not null, false),
    coalesce(store.is_published, false), coalesce(support.open_count, 0), support.last_support_at
  from auth.users users
  left join lateral (
    select selected_store.*
    from public.stores selected_store
    where selected_store.owner_id = users.id
    order by selected_store.created_at
    limit 1
  ) store on true
  left join lateral (
    select count(*)::bigint product_count, max(product.updated_at) last_updated_at
    from public.products product
    where product.store_id = store.id
  ) products on true
  left join lateral (
    select count(*)::bigint order_count,
      coalesce(sum(order_row.product_subtotal) filter (where order_row.status <> 'refunded'), 0) gross_sales,
      max(order_row.updated_at) last_created_at
    from public.orders order_row
    where order_row.store_id = store.id
  ) orders on true
  left join lateral (
    select count(*) filter (where conversation.status <> 'resolved')::bigint open_count,
      max(conversation.last_message_at) last_support_at
    from public.support_conversations conversation
    where conversation.user_id = users.id
  ) support on true
  where coalesce(users.raw_app_meta_data ->> 'role', '') <> 'admin'
  order by users.created_at desc;
end;
$$;

revoke all on function public.admin_dashboard_users() from public, anon;
grant execute on function public.admin_dashboard_users() to authenticated;

create or replace function public.sync_store_onboarding_journey()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_step text;
begin
  if new.owner_id is null then return new; end if;
  if exists (
    select 1
    from auth.users users
    where users.id = new.owner_id
      and coalesce(users.raw_app_meta_data ->> 'role', '') = 'admin'
  ) then
    delete from public.onboarding_journeys where user_id = new.owner_id;
    return new;
  end if;

  next_step := case
    when new.is_published then 'complete'
    when new.settings ->> 'onboardingStep' in ('store', 'business', 'payments', 'shipping', 'publish') then new.settings ->> 'onboardingStep'
    else 'business'
  end;

  insert into public.onboarding_journeys (user_id, store_id, step, last_activity_at, completed_at)
  values (new.owner_id, new.id, next_step, now(), case when new.is_published then now() end)
  on conflict (user_id) do update
  set store_id = excluded.store_id,
      step = case when public.onboarding_journeys.completed_at is not null then 'complete' else excluded.step end,
      last_activity_at = case when public.onboarding_journeys.completed_at is null then now() else public.onboarding_journeys.last_activity_at end,
      completed_at = coalesce(public.onboarding_journeys.completed_at, excluded.completed_at),
      claimed_reminder = null,
      claim_expires_at = null,
      updated_at = now();
  return new;
end;
$$;

create or replace function public.touch_onboarding_activity(target_step text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if target_step not in ('store', 'business', 'payments', 'shipping', 'publish') then
    raise exception 'Invalid onboarding step';
  end if;
  if exists (
    select 1
    from auth.users users
    where users.id = current_user_id
      and coalesce(users.raw_app_meta_data ->> 'role', '') = 'admin'
  ) then
    delete from public.onboarding_journeys where user_id = current_user_id;
    return;
  end if;

  insert into public.onboarding_journeys (user_id, step, last_activity_at)
  values (current_user_id, target_step, now())
  on conflict (user_id) do update
  set step = case when public.onboarding_journeys.completed_at is null then excluded.step else 'complete' end,
      last_activity_at = case when public.onboarding_journeys.completed_at is null then now() else public.onboarding_journeys.last_activity_at end,
      claimed_reminder = null,
      claim_expires_at = null,
      updated_at = now();
end;
$$;

create or replace function public.claim_onboarding_reminder()
returns table (
  user_id uuid,
  email text,
  store_name text,
  onboarding_step text,
  reminder_number smallint,
  unsubscribe_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  next_reminder smallint;
begin
  select journey.*, users.email, coalesce(store.name, 'Sinu pood') as resolved_store_name
  into candidate
  from public.onboarding_journeys as journey
  join auth.users as users on users.id = journey.user_id
  left join public.stores as store on store.id = journey.store_id
  where journey.completed_at is null
    and journey.reminders_disabled_at is null
    and journey.step <> 'complete'
    and coalesce(users.raw_app_meta_data ->> 'role', '') <> 'admin'
    and users.email_confirmed_at is not null
    and users.email is not null
    and journey.last_activity_at <= now() - interval '3 hours'
    and (journey.claim_expires_at is null or journey.claim_expires_at < now())
    and not exists (
      select 1 from public.user_presence_sessions as presence
      where presence.user_id = journey.user_id
        and presence.last_seen_at >= now() - interval '5 minutes'
    )
    and (
      journey.first_reminder_sent_at is null
      or (
        journey.second_reminder_sent_at is null
        and journey.last_activity_at <= now() - interval '24 hours'
        and journey.first_reminder_sent_at <= now() - interval '18 hours'
      )
    )
  order by journey.last_activity_at
  limit 1
  for update of journey skip locked;

  if not found then return; end if;
  next_reminder := case when candidate.first_reminder_sent_at is null then 1 else 2 end;

  update public.onboarding_journeys
  set claimed_reminder = next_reminder,
      claim_expires_at = now() + interval '15 minutes',
      updated_at = now()
  where public.onboarding_journeys.user_id = candidate.user_id;

  return query select
    candidate.user_id,
    candidate.email::text,
    candidate.resolved_store_name::text,
    candidate.step::text,
    next_reminder,
    candidate.unsubscribe_token;
end;
$$;

revoke all on function public.touch_onboarding_activity(text) from public, anon;
revoke all on function public.claim_onboarding_reminder() from public, anon, authenticated;
grant execute on function public.touch_onboarding_activity(text) to authenticated;
grant execute on function public.claim_onboarding_reminder() to service_role;

create or replace function public.remove_admin_from_merchant_automation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'role', '') = 'admin' then
    delete from public.onboarding_journeys where user_id = new.id;
    delete from public.user_presence_sessions where user_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.remove_admin_from_merchant_automation() from public, anon, authenticated;

drop trigger if exists exclude_admin_from_merchant_automation on auth.users;
create trigger exclude_admin_from_merchant_automation
after insert or update of raw_app_meta_data on auth.users
for each row execute function public.remove_admin_from_merchant_automation();

delete from public.onboarding_journeys journey
using auth.users users
where users.id = journey.user_id
  and coalesce(users.raw_app_meta_data ->> 'role', '') = 'admin';

delete from public.user_presence_sessions presence
using auth.users users
where users.id = presence.user_id
  and coalesce(users.raw_app_meta_data ->> 'role', '') = 'admin';

update public.admin_dashboard_refresh
set revision = revision + 1,
    updated_at = now()
where id = true;
