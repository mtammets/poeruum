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
) values
  (
    '73000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'image-owner@example.invalid',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '73000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'other-image-owner@example.invalid',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '73000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'image-admin@example.invalid',
    '{"role":"admin"}'::jsonb,
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
  '74000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  'Private image listing test',
  'private-image-listing-test',
  '{}'::text[],
  '{}'::jsonb
);

insert into storage.objects (bucket_id, name, metadata)
values
  (
    'product-images',
    '74000000-0000-4000-8000-000000000001/8c795753-40a7-4480-9820-a56ccee23ee4/master.webp',
    '{}'::jsonb
  ),
  (
    'product-images',
    '00000000-0000-4000-8000-000000000001/showcase/access-test.webp',
    '{}'::jsonb
  );

set local role anon;

do $$
begin
  if exists (
    select 1
    from storage.objects
    where bucket_id = 'product-images'
      and name like '%access-test.webp'
  ) then
    raise exception 'TEST_ANONYMOUS_CAN_LIST_PRODUCT_IMAGES';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"73000000-0000-4000-8000-000000000002","app_metadata":{}}',
  true
);
set local role authenticated;

do $$
begin
  if exists (
    select 1
    from storage.objects
    where bucket_id = 'product-images'
      and name like '74000000-0000-4000-8000-000000000001/%'
  ) then
    raise exception 'TEST_OTHER_OWNER_CAN_LIST_PRODUCT_IMAGES';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"73000000-0000-4000-8000-000000000001","app_metadata":{}}',
  true
);
set local role authenticated;

do $$
begin
  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'product-images'
      and name = '74000000-0000-4000-8000-000000000001/8c795753-40a7-4480-9820-a56ccee23ee4/master.webp'
  ) then
    raise exception 'TEST_OWNER_CANNOT_READ_OWN_PRODUCT_IMAGE';
  end if;
end;
$$;

do $$
declare
  deleted_rows integer;
begin
  delete from storage.objects
  where bucket_id = 'product-images'
    and name = '74000000-0000-4000-8000-000000000001/8c795753-40a7-4480-9820-a56ccee23ee4/master.webp';

  get diagnostics deleted_rows = row_count;
  if deleted_rows <> 1 then
    raise exception 'TEST_OWNER_CANNOT_DELETE_OWN_PRODUCT_IMAGE';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000003', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"73000000-0000-4000-8000-000000000003","app_metadata":{"role":"admin"}}',
  true
);
set local role authenticated;

do $$
begin
  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'product-images'
      and name = '00000000-0000-4000-8000-000000000001/showcase/access-test.webp'
  ) then
    raise exception 'TEST_ADMIN_CANNOT_READ_DEMO_PRODUCT_IMAGE';
  end if;
end;
$$;

rollback;
