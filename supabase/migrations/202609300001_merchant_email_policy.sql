-- Disposable addresses may try drafts, but cannot activate a merchant account.
create table public.email_domain_rules (
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z0-9-]+$'),
  disposable boolean not null,
  source text not null,
  updated_at timestamptz not null default now()
);
alter table public.email_domain_rules enable row level security;
revoke all on public.email_domain_rules from public, anon, authenticated;
grant all on public.email_domain_rules to service_role;

-- Explicit exceptions take precedence over a community classification.
insert into public.email_domain_rules(domain, disposable, source)
select domain, false, 'persistent-email-exception'
from unnest(array['gmail.com','outlook.com','hotmail.com','icloud.com','proton.me','protonmail.com','pm.me',
  'duck.com','privaterelay.appleid.com','mozmail.com','relay.firefox.com','simplelogin.com',
  'simplelogin.co','simplelogin.fr','slmail.me','8shield.net','aleeas.com','anonaddy.com','anonaddy.me','addy.io']) domain;
insert into public.email_domain_rules(domain, disposable, source) values
  ('minitts.net',true,'verified-2026-09-30'),('tozya.com',true,'verified-2026-09-30');

create function public.email_domain_is_disposable(email_address text)
returns boolean language sql stable security definer set search_path = '' as $$
  with parts as (
    select string_to_array(rtrim(lower(split_part(btrim(email_address), '@', 2)), '.'), '.') as labels
  ), matches as (
    select rule.disposable
    from parts cross join lateral generate_series(1, cardinality(parts.labels) - 1) as suffix(i)
    join public.email_domain_rules rule on rule.domain = array_to_string(parts.labels[suffix.i:cardinality(parts.labels)], '.')
  )
  select coalesce(bool_and(disposable), false) from matches;
$$;
revoke all on function public.email_domain_is_disposable(text) from public, anon, authenticated;
grant execute on function public.email_domain_is_disposable(text) to service_role;

create function public.account_email_status(candidate_email text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  account auth.users%rowtype;
  disposable boolean;
begin
  select * into account from auth.users where id = (select auth.uid());
  if account.id is null then raise exception 'Sisselogimine on nõutud.' using errcode = '42501'; end if;
  disposable := public.email_domain_is_disposable(account.email);
  return jsonb_build_object(
    'email', account.email,
    'pending_email', nullif(account.email_change, ''),
    'email_confirmed', account.email_confirmed_at is not null,
    'is_disposable', disposable,
    'activation_allowed', account.email_confirmed_at is not null and not disposable
      and (account.banned_until is null or account.banned_until <= now()),
    'candidate_is_disposable', case when candidate_email is null then null else public.email_domain_is_disposable(candidate_email) end
  );
end;
$$;
revoke all on function public.account_email_status(text) from public, anon;
grant execute on function public.account_email_status(text) to authenticated;

create function public.require_merchant_email(target_user_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users where id = target_user_id
    and email_confirmed_at is not null and not public.email_domain_is_disposable(email)
    and (banned_until is null or banned_until <= now())) then
    raise exception 'Enne poe avaldamist või maksete ühendamist vaheta konto ajutine e-post püsiva aadressi vastu ja kinnita see.'
      using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.require_merchant_email(uuid) from public, anon, authenticated;
grant execute on function public.require_merchant_email(uuid) to service_role;

-- Do not allow an activated merchant to evade the rule with an email change.
create function public.guard_activated_merchant_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email and public.email_domain_is_disposable(new.email)
    and exists (select 1 from public.stores where owner_id = new.id and (is_published or stripe_account_id is not null)) then
    raise exception 'Poe konto jaoks kasuta püsivat e-posti aadressi.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_activated_merchant_email() from public, anon, authenticated;
create trigger users_guard_activated_merchant_email before update of email on auth.users
for each row execute function public.guard_activated_merchant_email();

-- Store publication is a privileged state transition. Store owners may edit
-- draft content directly, but only these functions may publish or unpublish a
-- store.

create or replace function public.publish_store(target_store_id uuid)
returns public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_store public.stores%rowtype;
  target_settings jsonb;
begin
  if current_user_id is null then
    raise exception 'Poe avaldamiseks logi sisse.' using errcode = '42501';
  end if;

  select store.*
  into target_store
  from public.stores as store
  where store.id = target_store_id
    and store.owner_id = current_user_id
  for update;

  if target_store.id is null then
    raise exception 'Poodi ei leitud või sul puudub selle muutmise õigus.' using errcode = '42501';
  end if;

  perform public.require_merchant_email(current_user_id);

  if target_store.is_published then
    return target_store;
  end if;

  target_settings := coalesce(target_store.settings, '{}'::jsonb);

  if btrim(coalesce(target_settings ->> 'businessName', '')) = ''
    or coalesce(target_settings ->> 'registryCode', '') !~ '^[0-9]{8}$'
    or btrim(coalesce(target_settings ->> 'businessAddress', '')) = ''
    or btrim(coalesce(target_settings ->> 'contactEmail', ''))
      !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or (
      coalesce(target_settings ->> 'vatRegistered', 'false') = 'true'
      and upper(btrim(coalesce(target_settings ->> 'vatNumber', ''))) !~ '^EE[0-9]{9}$'
    ) then
    raise exception 'Enne avaldamist lisa täielikud müüja andmed.';
  end if;

  if target_store.payment_provider <> 'stripe'
    or target_store.payment_status <> 'connected'
    or target_store.stripe_account_id is null
    or not target_store.stripe_account_charges_enabled
    or not target_store.stripe_account_payouts_enabled then
    raise exception 'Enne avaldamist ühenda Stripe’i maksed.';
  end if;

  if coalesce(cardinality(target_store.shipping), 0) = 0 then
    raise exception 'Enne avaldamist vali vähemalt üks tarneviis.';
  end if;

  if not exists (
    select 1
    from public.products as product
    where product.store_id = target_store.id
  ) then
    raise exception 'Enne avaldamist lisa vähemalt üks toode.';
  end if;

  if target_store.pricing_plan = 'fixed'
    and coalesce(target_store.stripe_subscription_status, '') not in ('active', 'trialing') then
    raise exception 'Kindla paketi tellimus peab enne avaldamist olema aktiivne.';
  end if;

  update public.stores
  set is_published = true,
      settings = jsonb_set(target_settings, '{onboardingStep}', '"complete"'::jsonb, true)
  where id = target_store.id
  returning * into target_store;

  return target_store;
end;
$$;


revoke all on function public.publish_store(uuid) from public, anon;
grant execute on function public.publish_store(uuid) to authenticated;

drop function public.admin_dashboard_users();


create function public.admin_dashboard_users()
returns table (
  user_id uuid,
  email text,
  user_created_at timestamptz,
  last_sign_in_at timestamptz,
  store_id uuid,
  store_name text,
  store_slug text,
  custom_hostname text,
  store_created_at timestamptz,
  is_published boolean,
  payment_status text,
  stripe_account_requirement_issues jsonb,
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
  last_support_at timestamptz,
  email_confirmed boolean,
  email_is_disposable boolean,
  email_review_required boolean
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
  select
    users.id,
    users.email::text,
    users.created_at,
    users.last_sign_in_at,
    store.id,
    store.name,
    store.slug,
    custom_domain.hostname,
    store.created_at,
    coalesce(store.is_published, false),
    coalesce(store.payment_status, 'idle'),
    coalesce(store.stripe_account_requirement_issues, '[]'::jsonb),
    coalesce(store.pricing_plan, 'flexible'),
    coalesce(products.product_count, 0),
    coalesce(orders.order_count, 0),
    coalesce(orders.gross_sales, 0),
    greatest(users.last_sign_in_at, store.updated_at, products.last_updated_at, orders.last_created_at),
    coalesce(nullif(btrim(store.name), '') is not null, false),
    coalesce(store.payment_status = 'connected', false),
    coalesce(cardinality(store.shipping) > 0, false),
    coalesce(products.product_count > 0, false),
    coalesce(
      nullif(btrim(store.settings ->> 'businessName'), '') is not null
      and (store.settings ->> 'registryCode') ~ '^\d{8}$'
      and nullif(btrim(store.settings ->> 'businessAddress'), '') is not null
      and nullif(btrim(store.settings ->> 'contactEmail'), '') is not null,
      false
    ),
    coalesce(store.is_published, false),
    coalesce(support.open_count, 0),
    support.last_support_at,
    users.email_confirmed_at is not null,
    public.email_domain_is_disposable(users.email),
    public.email_domain_is_disposable(users.email)
      and not coalesce(store.is_published, false)
      and greatest(users.created_at, users.last_sign_in_at, store.updated_at, products.last_updated_at, journey.last_activity_at, support.last_support_at, orders.last_created_at) <= now() - interval '30 days'
  from auth.users users
  left join lateral (
    select selected_store.*
    from public.stores selected_store
    where selected_store.owner_id = users.id
    order by selected_store.created_at
    limit 1
  ) store on true
  left join public.onboarding_journeys journey on journey.user_id = users.id
  left join lateral (
    select domain.hostname
    from public.custom_domains domain
    where domain.store_id = store.id
      and domain.status = 'active'
    limit 1
  ) custom_domain on true
  left join lateral (
    select count(*)::bigint product_count, max(product.updated_at) last_updated_at
    from public.products product
    where product.store_id = store.id
  ) products on true
  left join lateral (
    select
      count(*)::bigint order_count,
      coalesce(sum(order_row.product_subtotal) filter (where order_row.status <> 'refunded'), 0) gross_sales,
      max(order_row.updated_at) last_created_at
    from public.orders order_row
    where order_row.store_id = store.id
  ) orders on true
  left join lateral (
    select
      count(*) filter (where conversation.status <> 'resolved')::bigint open_count,
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

comment on function public.admin_dashboard_users() is
  'Returns merchant setup, activity and sanitized Stripe issue data to platform administrators.';
