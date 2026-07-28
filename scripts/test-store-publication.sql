\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '71000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'publication-test@example.invalid',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.stores (
  id,
  owner_id,
  name,
  slug,
  shipping,
  settings
) values (
  '72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'Publication test store',
  'publication-test-store',
  '{}'::text[],
  '{}'::jsonb
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
begin
  begin
    perform public.publish_store('72000000-0000-4000-8000-000000000001');
    raise exception 'TEST_UNEXPECTED_PUBLICATION';
  exception when others then
    if sqlerrm = 'TEST_UNEXPECTED_PUBLICATION'
      or sqlerrm <> 'Enne avaldamist lisa täielikud müüja andmed.' then
      raise;
    end if;
  end;
end;
$$;

reset role;

update public.stores
set settings = jsonb_build_object(
  'businessName', 'Publication Test OÜ',
  'registryCode', '12345678',
  'businessAddress', 'Test 1, Tallinn',
  'contactEmail', 'merchant@example.invalid',
  'vatRegistered', false
)
where id = '72000000-0000-4000-8000-000000000001';

set local role authenticated;

do $$
begin
  begin
    perform public.publish_store('72000000-0000-4000-8000-000000000001');
    raise exception 'TEST_UNEXPECTED_PUBLICATION';
  exception when others then
    if sqlerrm = 'TEST_UNEXPECTED_PUBLICATION'
      or sqlerrm <> 'Enne avaldamist ühenda Stripe’i maksed.' then
      raise;
    end if;
  end;
end;
$$;

reset role;

update public.stores
set payment_status = 'connected',
    stripe_account_id = 'acct_publication_test',
    stripe_account_charges_enabled = true,
    stripe_account_payouts_enabled = true
where id = '72000000-0000-4000-8000-000000000001';

set local role authenticated;

do $$
begin
  begin
    perform public.publish_store('72000000-0000-4000-8000-000000000001');
    raise exception 'TEST_UNEXPECTED_PUBLICATION';
  exception when others then
    if sqlerrm = 'TEST_UNEXPECTED_PUBLICATION'
      or sqlerrm <> 'Enne avaldamist vali vähemalt üks tarneviis.' then
      raise;
    end if;
  end;
end;
$$;

reset role;

update public.stores
set shipping = array['pickup']::text[]
where id = '72000000-0000-4000-8000-000000000001';

set local role authenticated;

do $$
begin
  begin
    perform public.publish_store('72000000-0000-4000-8000-000000000001');
    raise exception 'TEST_UNEXPECTED_PUBLICATION';
  exception when others then
    if sqlerrm = 'TEST_UNEXPECTED_PUBLICATION'
      or sqlerrm <> 'Enne avaldamist lisa vähemalt üks toode.' then
      raise;
    end if;
  end;
end;
$$;

reset role;

insert into public.products (
  id,
  store_id,
  name,
  description,
  image_url,
  price,
  slug
) values (
  'publication-test-product',
  '72000000-0000-4000-8000-000000000001',
  'Publication test product',
  'Product required before publication',
  'https://example.invalid/product.webp',
  10,
  'publication-test-product'
);

set local role authenticated;

select public.publish_store('72000000-0000-4000-8000-000000000001');

do $$
begin
  if not exists (
    select 1
    from public.stores
    where id = '72000000-0000-4000-8000-000000000001'
      and is_published
      and settings ->> 'onboardingStep' = 'complete'
  ) then
    raise exception 'TEST_PUBLICATION_DID_NOT_COMPLETE';
  end if;
end;
$$;

update public.stores
set settings = settings || '{"autosaveProbe": true}'::jsonb
where id = '72000000-0000-4000-8000-000000000001';

do $$
begin
  if not exists (
    select 1
    from public.stores
    where id = '72000000-0000-4000-8000-000000000001'
      and is_published
      and settings ->> 'autosaveProbe' = 'true'
  ) then
    raise exception 'TEST_AUTOSAVE_CHANGED_PUBLICATION';
  end if;
end;
$$;

do $$
begin
  begin
    update public.stores
    set is_published = false
    where id = '72000000-0000-4000-8000-000000000001';
    raise exception 'TEST_DIRECT_PUBLICATION_UPDATE_SUCCEEDED';
  exception
    when insufficient_privilege then null;
  end;

  if not exists (
    select 1
    from public.stores
    where id = '72000000-0000-4000-8000-000000000001'
      and is_published
  ) then
    raise exception 'TEST_DIRECT_UPDATE_CHANGED_PUBLICATION';
  end if;
end;
$$;

select public.unpublish_store('72000000-0000-4000-8000-000000000001');

do $$
begin
  if exists (
    select 1
    from public.stores
    where id = '72000000-0000-4000-8000-000000000001'
      and is_published
  ) then
    raise exception 'TEST_UNPUBLICATION_DID_NOT_COMPLETE';
  end if;
end;
$$;

rollback;
