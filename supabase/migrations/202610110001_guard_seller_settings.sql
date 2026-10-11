-- A draft seller edit must never deactivate a working shop. The authenticated
-- client cannot change a connected seller's identity or tax status by PATCH.
create or replace function public.store_seller_settings(value jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'sellerType',coalesce(value->>'sellerType','company'),
    'sellerFirstName',coalesce(value->>'sellerFirstName',''),
    'sellerLastName',coalesce(value->>'sellerLastName',''),
    'entrepreneurPayoutConfirmed',coalesce(value->'entrepreneurPayoutConfirmed'='true'::jsonb,false),
    'businessName',coalesce(value->>'businessName',''),
    'registryCode',coalesce(value->>'registryCode',''),
    'businessAddress',coalesce(value->>'businessAddress',''),
    'contactEmail',coalesce(value->>'contactEmail',''),
    'vatRegistered',coalesce(value->'vatRegistered'='true'::jsonb,false),
    'vatNumber',coalesce(value->>'vatNumber',''));
$$;
revoke all on function public.store_seller_settings(jsonb) from public,anon;
grant execute on function public.store_seller_settings(jsonb) to authenticated,service_role;

create or replace function public.guard_connected_seller_settings()
returns trigger language plpgsql security definer set search_path='' as $$
declare before_value jsonb:=public.store_seller_settings(old.settings);
  after_value jsonb:=public.store_seller_settings(new.settings);
begin
  if before_value=after_value then return new; end if;
  if old.stripe_account_id is not null and auth.role() is distinct from 'service_role' and (
    public.seller_identity_key(old.settings) is distinct from public.seller_identity_key(new.settings)
    or before_value->'vatRegistered' is distinct from after_value->'vatRegistered'
    or before_value->'vatNumber' is distinct from after_value->'vatNumber') then
    raise exception 'Muuda juriidilisi ja käibemaksuandmeid müüja andmete kinnitamise vormis.' using errcode='42501';
  end if;
  -- Still allow an entrepreneur to withdraw their payout declaration. All other
  -- required fields must remain complete once the seller has been configured.
  if (old.is_published or public.seller_details_complete(old.settings))
    and not public.seller_details_complete(new.settings||'{"entrepreneurPayoutConfirmed":true}'::jsonb) then
    raise exception 'Müüja andmed on puudulikud. Täida kohustuslikud väljad enne salvestamist.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_connected_seller_settings() from public,anon,authenticated;
drop trigger if exists stores_zz_guard_seller_settings on public.stores;
create trigger stores_zz_guard_seller_settings before update of settings on public.stores
  for each row execute function public.guard_connected_seller_settings();

-- Service-only entry point: the Edge handler authenticates the owner and reads
-- Stripe before calling this. Row locking and the expected snapshot protect
-- against concurrent edits/account replacement. Unrelated settings are merged.
create or replace function public.save_store_seller_details(
  target_store_id uuid, owner_id_value uuid, expected_seller jsonb, seller_value jsonb,
  account_id_value text, account_mode_value text, stripe_ready_value boolean, bank_value jsonb)
returns public.stores language plpgsql security definer set search_path='' as $$
declare target public.stores%rowtype; merged jsonb; changed_identity boolean;
begin
  select * into target from public.stores where id=target_store_id and owner_id=owner_id_value for update;
  if not found or target.stripe_account_id is distinct from account_id_value
    or target.stripe_account_mode is distinct from account_mode_value
    or public.store_seller_settings(target.settings) is distinct from expected_seller then
    raise exception 'SELLER_CHANGED';
  end if;
  if seller_value is distinct from public.store_seller_settings(seller_value) then raise exception 'INVALID_SELLER_SETTINGS'; end if;
  merged:=target.settings||seller_value;
  if target.stripe_account_id is not null and (
    coalesce(target.settings->>'sellerType','company') is distinct from merged->>'sellerType'
    or coalesce(target.settings->>'registryCode','') is distinct from merged->>'registryCode') then
    raise exception 'SELLER_TRANSFER_REQUIRED';
  end if;
  if not public.seller_details_complete(merged) then raise exception 'INVALID_SELLER_SETTINGS'; end if;
  changed_identity:=public.seller_identity_key(target.settings) is distinct from public.seller_identity_key(merged);
  if target.stripe_account_id is not null and changed_identity and (stripe_ready_value is distinct from true or bank_value is null) then
    raise exception 'STRIPE_VERIFICATION_REQUIRED';
  end if;
  update public.stores set settings=merged where id=target_store_id returning * into target;
  if target.stripe_account_id is not null and changed_identity then
    perform public.sync_store_payment_check(target.id,target.stripe_account_id,target.stripe_account_mode,target.settings,bank_value,null,true);
    select * into target from public.stores where id=target_store_id;
    if target.payment_status<>'connected' then raise exception 'STRIPE_VERIFICATION_REQUIRED'; end if;
  end if;
  return target;
end;
$$;
revoke all on function public.save_store_seller_details(uuid,uuid,jsonb,jsonb,text,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.save_store_seller_details(uuid,uuid,jsonb,jsonb,text,text,boolean,jsonb) to service_role;
