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

create or replace function public.unpublish_store(target_store_id uuid)
returns public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_store public.stores%rowtype;
begin
  if current_user_id is null then
    raise exception 'Poe peitmiseks logi sisse.' using errcode = '42501';
  end if;

  update public.stores
  set is_published = false
  where id = target_store_id
    and owner_id = current_user_id
  returning * into target_store;

  if target_store.id is null then
    raise exception 'Poodi ei leitud või sul puudub selle muutmise õigus.' using errcode = '42501';
  end if;

  return target_store;
end;
$$;

revoke all on function public.publish_store(uuid) from public, anon;
revoke all on function public.unpublish_store(uuid) from public, anon;
grant execute on function public.publish_store(uuid) to authenticated;
grant execute on function public.unpublish_store(uuid) to authenticated;

-- Rebuild the existing column grants without is_published. The service role
-- continues to bypass these grants for billing, account deletion and system
-- maintenance.
revoke insert, update on table public.stores from authenticated;
revoke insert (is_published) on table public.stores from authenticated;
revoke update (is_published) on table public.stores from authenticated;
grant insert (
  owner_id,
  name,
  slug,
  payment_provider,
  shipping,
  settings
) on public.stores to authenticated;
grant update (
  name,
  slug,
  payment_provider,
  shipping,
  settings
) on public.stores to authenticated;

comment on function public.publish_store(uuid) is
  'Atomically validates an owned store and publishes it.';
comment on function public.unpublish_store(uuid) is
  'Allows a store owner to remove an owned store from public view.';

do $$
begin
  if has_column_privilege('authenticated', 'public.stores', 'is_published', 'INSERT')
    or has_column_privilege('authenticated', 'public.stores', 'is_published', 'UPDATE') then
    raise exception 'ACCESS_ASSERTION_FAILED: authenticated can write stores.is_published directly';
  end if;
  if not has_function_privilege('authenticated', 'public.publish_store(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.unpublish_store(uuid)', 'EXECUTE') then
    raise exception 'ACCESS_ASSERTION_FAILED: authenticated cannot manage owned store publication';
  end if;
end;
$$;
