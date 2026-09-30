-- Seller identity stays explicit; legacy shops are companies.
create function public.seller_details_complete(settings_value jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(
    coalesce(settings_value->>'sellerType','company') in ('company','entrepreneur')
    and length(btrim(coalesce(settings_value->>'businessAddress',''))) between 1 and 400
    and length(btrim(coalesce(settings_value->>'contactEmail',''))) between 1 and 254
    and btrim(settings_value->>'contactEmail') ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and case when settings_value->>'sellerType'='entrepreneur' then
      length(btrim(coalesce(settings_value->>'sellerFirstName',''))) between 1 and 100
      and length(btrim(coalesce(settings_value->>'sellerLastName',''))) between 1 and 100
      and settings_value->'entrepreneurAccountConfirmed'='true'::jsonb
      and coalesce(settings_value->>'vatRegistered','false')='false'
      and btrim(coalesce(settings_value->>'vatNumber',''))=''
    else
      length(btrim(coalesce(settings_value->>'businessName',''))) between 1 and 200
      and btrim(coalesce(settings_value->>'registryCode','')) ~ '^[0-9]{8}$'
      and (coalesce(settings_value->>'vatRegistered','false')='false'
        or upper(btrim(coalesce(settings_value->>'vatNumber',''))) ~ '^EE[0-9]{9}$')
    end, false);
$$;
revoke all on function public.seller_details_complete(jsonb) from public,anon,authenticated;
grant execute on function public.seller_details_complete(jsonb) to service_role;

create function public.guard_store_seller_identity()
returns trigger language plpgsql set search_path='' as $$
declare new_type text:=coalesce(new.settings->>'sellerType','company');
begin
  if new_type not in ('company','entrepreneur') then raise exception 'Vali müüja tüüp.'; end if;
  if tg_op='UPDATE' and old.stripe_account_id is not null
    and new_type is distinct from coalesce(old.settings->>'sellerType','company') then
    raise exception 'Müüja tüübi muutmiseks võta ühendust Poeruumi toega.';
  end if;
  if new_type='entrepreneur' then
    if coalesce(new.settings->>'vatRegistered','false') <> 'false'
      or btrim(coalesce(new.settings->>'vatNumber','')) <> '' then
      raise exception 'Ettevõtluskonto kasutaja ei saa olla käibemaksukohustuslane.';
    end if;
    new.settings:=new.settings || jsonb_build_object(
      'businessName', btrim(concat_ws(' ',nullif(btrim(new.settings->>'sellerFirstName'),''),nullif(btrim(new.settings->>'sellerLastName'),''))),
      'registryCode','','vatRegistered',false,'vatNumber','');
  end if;
  return new;
end;
$$;
create trigger stores_guard_seller_identity before insert or update of settings on public.stores
  for each row execute function public.guard_store_seller_identity();

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

  if not public.seller_details_complete(target_settings) then
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

create or replace function public.admin_dashboard_users()
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
    public.seller_details_complete(store.settings),
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

create or replace function public.create_invoiced_stripe_order(
  target_store_id uuid, request_id text, order_number_value text, order_items jsonb,
  customer_name_value text, customer_email_value text, delivery_value text,
  product_subtotal_value numeric, total_value numeric, stripe_mode_value text,
  reservation_expires_at_value timestamptz, invoice_value jsonb
) returns public.orders language plpgsql security definer set search_path='' as $$
declare target public.orders%rowtype; line jsonb; gross bigint:=0; net bigint:=0; tax bigint:=0;
begin
  if invoice_value is null or invoice_value->>'version' is distinct from '1'
    or invoice_value->>'currency' is distinct from 'eur'
    or jsonb_typeof(invoice_value->'lines') is distinct from 'array'
    or jsonb_array_length(invoice_value->'lines') not between 1 and 51
    or lower(invoice_value#>>'{buyer,email}') is distinct from lower(customer_email_value)
    or nullif(btrim(invoice_value#>>'{buyer,name}'),'') is null
    or nullif(btrim(invoice_value#>>'{buyer,address}'),'') is null
    or nullif(btrim(invoice_value#>>'{seller,name}'),'') is null
    or nullif(btrim(invoice_value#>>'{seller,address}'),'') is null
    or coalesce(invoice_value#>>'{seller,type}','company') not in ('company','entrepreneur')
    or (case when invoice_value#>>'{seller,type}'='entrepreneur' then
      coalesce(invoice_value#>>'{seller,registryCode}','') <> ''
      or coalesce(invoice_value#>>'{seller,vatNumber}','') <> ''
      or invoice_value->>'vatRate' is not null
      or not exists (select 1 from public.stores s where s.id=target_store_id
        and s.settings->>'sellerType'='entrepreneur' and public.seller_details_complete(s.settings))
    else coalesce(invoice_value#>>'{seller,registryCode}','') !~ '^[0-9]{8}$' end)
    or (invoice_value->>'vatRate')::numeric is not null and (invoice_value->>'vatRate')::numeric <> 24 then
    raise exception 'INVALID_INVOICE_SNAPSHOT';
  end if;
  for line in select value from jsonb_array_elements(invoice_value->'lines') loop
    if (line->>'quantity')::integer not between 1 and 99 or (line->>'unitGrossCents')::bigint <= 0
      or (line->>'grossCents')::bigint is distinct from (line->>'quantity')::integer*(line->>'unitGrossCents')::bigint
      or (line->>'netCents')::bigint < 0 or (line->>'vatCents')::bigint < 0
      or (line->>'grossCents')::bigint is distinct from (line->>'netCents')::bigint+(line->>'vatCents')::bigint then
      raise exception 'INVALID_INVOICE_LINES';
    end if;
    gross:=gross+(line->>'grossCents')::bigint;
    net:=net+(line->>'netCents')::bigint;
    tax:=tax+(line->>'vatCents')::bigint;
  end loop;
  if gross is distinct from round(total_value*100)::bigint
    or gross is distinct from (invoice_value->>'totalCents')::bigint
    or net is distinct from (invoice_value->>'netCents')::bigint
    or tax is distinct from (invoice_value->>'vatCents')::bigint
    or tax is distinct from (case when invoice_value->>'vatRate' is null then 0 else round(gross*24.0/124)::bigint end) then
    raise exception 'INVOICE_TOTAL_MISMATCH';
  end if;
  target:=public.create_stripe_order_with_reservation(target_store_id,request_id,order_number_value,order_items,
    customer_name_value,customer_email_value,delivery_value,product_subtotal_value,total_value,stripe_mode_value,reservation_expires_at_value);
  if target.invoice_snapshot is not null then
    if target.invoice_snapshot->'buyer' is distinct from invoice_value->'buyer' then raise exception 'CHECKOUT_REQUEST_REUSED'; end if;
    return target;
  end if;
  -- A pre-upgrade Checkout attempt must retain its original behavior.
  if target.stripe_checkout_started_at is not null or target.payment_status<>'pending' then return target; end if;
  update public.orders set invoice_snapshot=invoice_value,
    seller_vat_registered=invoice_value->>'vatRate' is not null,
    seller_vat_number=nullif(invoice_value#>>'{seller,vatNumber}',''),
    seller_vat_rate=(invoice_value->>'vatRate')::numeric,
    seller_vat_amount=tax/100.0
  where id=target.id returning * into target;
  return target;
end;
$$;

create or replace function public.storefront_seo_document(requested_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'store_id', s.id,
    'store_name', s.name,
    'store_slug', s.slug,
    'store_updated_at', s.updated_at,
    'settings', jsonb_strip_nulls(jsonb_build_object(
      'storeDescription', s.settings -> 'storeDescription',
      'seoTitle', s.settings -> 'seoTitle',
      'seoDescription', s.settings -> 'seoDescription',
      'productBrand', s.settings -> 'productBrand',
      'searchConsoleVerification', s.settings -> 'searchConsoleVerification',
      'storeLogo', s.settings -> 'storeLogo',
      'socialImage', s.settings -> 'socialImage',
      'businessName', s.settings -> 'businessName',
      'sellerType', s.settings -> 'sellerType',
      'deliverySettings', s.settings -> 'deliverySettings',
      'returnsText', s.settings -> 'returnsText',
      'contactEmail', s.settings -> 'contactEmail',
      'contactPhone', s.settings -> 'contactPhone'
    )),
    'shipping', s.shipping,
    'primary_hostname', coalesce((
      select d.hostname
      from public.custom_domains d
      where d.store_id = s.id and d.status = 'active'
      limit 1
    ), s.slug || '.poeruum.ee'),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'slug', coalesce(nullif(p.slug, ''), p.id),
          'description', coalesce(p.description, ''),
          'seo_title', coalesce(nullif(p.seo_title, ''), p.name || ' – ' || s.name),
          'image_url', p.image_url,
          'gallery', p.gallery,
          'alt', coalesce(nullif(p.alt, ''), p.name),
          'price', p.price,
          'sale_price', p.sale_price,
          'stock', p.stock,
          'one_of_a_kind', p.one_of_a_kind,
          'options', p.options,
          'search_visible', p.search_visible,
          'updated_at', p.updated_at
        )
        order by p.sort_order, p.created_at
      )
      from public.products p
      where p.store_id = s.id
    ), '[]'::jsonb),
    'url_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'old_slug', h.old_slug,
        'new_slug', h.new_slug,
        'status', h.status
      ))
      from public.product_url_history h
      where h.store_id = s.id
    ), '[]'::jsonb)
  )
  from public.stores s
  where s.slug = lower(btrim(requested_slug))
    and s.is_published = true
    and s.owner_id is not null
  limit 1;
$$;

revoke all on function public.storefront_seo_document(text) from public;
grant execute on function public.storefront_seo_document(text) to anon, authenticated;
