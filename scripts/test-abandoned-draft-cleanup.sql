\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  (
    '75000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'cleanup-notice@example.invalid',
    now() - interval '200 days',
    '{}'::jsonb,
    '{}'::jsonb,
    now() - interval '200 days',
    now() - interval '200 days'
  ),
  (
    '75000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'cleanup-delete@example.invalid',
    now() - interval '200 days',
    '{}'::jsonb,
    '{}'::jsonb,
    now() - interval '200 days',
    now() - interval '200 days'
  ),
  (
    '75000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'cleanup-active@example.invalid',
    now() - interval '200 days',
    '{}'::jsonb,
    '{}'::jsonb,
    now() - interval '200 days',
    now() - interval '200 days'
  ),
  (
    '75000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'cleanup-product@example.invalid',
    now() - interval '200 days',
    '{}'::jsonb,
    '{}'::jsonb,
    now() - interval '200 days',
    now() - interval '200 days'
  ),
  (
    '75000000-0000-4000-8000-000000000005',
    'authenticated',
    'authenticated',
    'cleanup-stripe@example.invalid',
    now() - interval '200 days',
    '{}'::jsonb,
    '{}'::jsonb,
    now() - interval '200 days',
    now() - interval '200 days'
  ),
  (
    '75000000-0000-4000-8000-000000000006',
    'authenticated',
    'authenticated',
    'cleanup-completed@example.invalid',
    now() - interval '200 days',
    '{}'::jsonb,
    '{}'::jsonb,
    now() - interval '200 days',
    now() - interval '200 days'
  );

insert into public.stores (
  id,
  owner_id,
  name,
  slug,
  is_published,
  payment_status,
  stripe_account_id,
  shipping,
  settings,
  created_at,
  updated_at
) values
  (
    '76000000-0000-4000-8000-000000000001',
    '75000000-0000-4000-8000-000000000001',
    'Cleanup notice draft',
    'cleanup-notice-draft',
    false,
    'idle',
    null,
    '{}'::text[],
    '{"onboardingStep":"business"}'::jsonb,
    now() - interval '174 days',
    now() - interval '174 days'
  ),
  (
    '76000000-0000-4000-8000-000000000002',
    '75000000-0000-4000-8000-000000000002',
    'Cleanup deletion draft',
    'cleanup-deletion-draft',
    false,
    'idle',
    null,
    '{}'::text[],
    '{"onboardingStep":"business"}'::jsonb,
    now() - interval '181 days',
    now() - interval '181 days'
  ),
  (
    '76000000-0000-4000-8000-000000000003',
    '75000000-0000-4000-8000-000000000003',
    'Recently active draft',
    'recently-active-draft',
    false,
    'idle',
    null,
    '{}'::text[],
    '{"onboardingStep":"business"}'::jsonb,
    now() - interval '181 days',
    now() - interval '10 days'
  ),
  (
    '76000000-0000-4000-8000-000000000004',
    '75000000-0000-4000-8000-000000000004',
    'Draft with product',
    'draft-with-product',
    false,
    'idle',
    null,
    '{}'::text[],
    '{"onboardingStep":"product"}'::jsonb,
    now() - interval '181 days',
    now() - interval '181 days'
  ),
  (
    '76000000-0000-4000-8000-000000000005',
    '75000000-0000-4000-8000-000000000005',
    'Draft with Stripe',
    'draft-with-stripe',
    false,
    'pending',
    'acct_cleanup_protected',
    '{}'::text[],
    '{"onboardingStep":"payments"}'::jsonb,
    now() - interval '181 days',
    now() - interval '181 days'
  ),
  (
    '76000000-0000-4000-8000-000000000006',
    '75000000-0000-4000-8000-000000000006',
    'Previously completed store',
    'previously-completed-store',
    false,
    'idle',
    null,
    '{}'::text[],
    '{"onboardingStep":"complete"}'::jsonb,
    now() - interval '181 days',
    now() - interval '181 days'
  );

insert into public.products (
  id,
  store_id,
  name,
  image_url,
  price,
  slug
) values (
  'cleanup-protected-product',
  '76000000-0000-4000-8000-000000000004',
  'Protected product',
  'https://example.invalid/protected.webp',
  10,
  'protected-product'
);

update public.onboarding_journeys
set
  step = case
    when user_id = '75000000-0000-4000-8000-000000000004' then 'product'
    else 'business'
  end,
  last_activity_at = case
    when user_id = '75000000-0000-4000-8000-000000000001' then now() - interval '174 days'
    when user_id = '75000000-0000-4000-8000-000000000003' then now() - interval '10 days'
    else now() - interval '181 days'
  end,
  first_reminder_sent_at = now() - interval '190 days',
  second_reminder_sent_at = now() - interval '189 days',
  cleanup_notice_sent_at = case
    when user_id = '75000000-0000-4000-8000-000000000001' then null
    else now() - interval '8 days'
  end,
  completed_at = case
    when user_id = '75000000-0000-4000-8000-000000000006' then now() - interval '181 days'
    else null
  end,
  claimed_reminder = null,
  claim_expires_at = null;

do $$
declare
  claim record;
begin
  select *
  into claim
  from public.claim_onboarding_reminder_v2();

  if claim.user_id is distinct from '75000000-0000-4000-8000-000000000001'::uuid
    or claim.reminder_number is distinct from 3
  then
    raise exception 'TEST_CLEANUP_NOTICE_NOT_CLAIMED';
  end if;

  perform public.complete_onboarding_reminder_claim(claim.user_id, claim.reminder_number);
end;
$$;

do $$
begin
  if not exists (
    select 1
    from public.onboarding_journeys
    where user_id = '75000000-0000-4000-8000-000000000001'
      and cleanup_notice_sent_at is not null
  ) then
    raise exception 'TEST_CLEANUP_NOTICE_NOT_COMPLETED';
  end if;
end;
$$;

update public.stores
set settings = settings || '{"draftCleanupProbe": true}'::jsonb
where id = '76000000-0000-4000-8000-000000000001';

do $$
begin
  if exists (
    select 1
    from public.onboarding_journeys
    where user_id = '75000000-0000-4000-8000-000000000001'
      and cleanup_notice_sent_at is not null
  ) then
    raise exception 'TEST_STORE_UPDATE_DID_NOT_CANCEL_CLEANUP';
  end if;
end;
$$;

update public.onboarding_journeys
set cleanup_notice_sent_at = now(),
    claimed_reminder = 3,
    claim_expires_at = now() + interval '15 minutes'
where user_id = '75000000-0000-4000-8000-000000000001';

update auth.users
set last_sign_in_at = now()
where id = '75000000-0000-4000-8000-000000000001';

do $$
begin
  if exists (
    select 1
    from public.onboarding_journeys
    where user_id = '75000000-0000-4000-8000-000000000001'
      and cleanup_notice_sent_at is not null
  ) then
    raise exception 'TEST_SIGN_IN_DID_NOT_CANCEL_CLEANUP';
  end if;
end;
$$;

update public.onboarding_journeys
set cleanup_notice_sent_at = now(),
    claimed_reminder = 3,
    claim_expires_at = now() + interval '15 minutes'
where user_id = '75000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"75000000-0000-4000-8000-000000000001","app_metadata":{}}',
  true
);
set local role authenticated;
select public.touch_onboarding_activity('business');
reset role;

do $$
begin
  if exists (
    select 1
    from public.onboarding_journeys
    where user_id = '75000000-0000-4000-8000-000000000001'
      and cleanup_notice_sent_at is not null
  ) then
    raise exception 'TEST_ACTIVITY_DID_NOT_CANCEL_CLEANUP';
  end if;
end;
$$;

do $$
declare
  result jsonb;
begin
  result := public.apply_data_retention(now());
  if coalesce((result ->> 'abandoned_drafts')::integer, 0) <> 1 then
    raise exception 'TEST_UNEXPECTED_ABANDONED_DRAFT_COUNT: %', result;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.stores
    where id = '76000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'TEST_ABANDONED_EMPTY_DRAFT_NOT_DELETED';
  end if;

  if not exists (
    select 1
    from public.external_resource_cleanup
    where provider = 'supabase_storage'
      and resource_type = 'product_image_prefix'
      and resource_id = '76000000-0000-4000-8000-000000000002'
      and status = 'pending'
  ) then
    raise exception 'TEST_DRAFT_STORAGE_CLEANUP_NOT_QUEUED';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = '75000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'TEST_DRAFT_CLEANUP_DELETED_USER_ACCOUNT';
  end if;

  if not exists (
    select 1
    from public.stores
    where id in (
      '76000000-0000-4000-8000-000000000001',
      '76000000-0000-4000-8000-000000000003',
      '76000000-0000-4000-8000-000000000004',
      '76000000-0000-4000-8000-000000000005',
      '76000000-0000-4000-8000-000000000006'
    )
    having count(*) = 5
  ) then
    raise exception 'TEST_PROTECTED_DRAFT_WAS_DELETED';
  end if;
end;
$$;

rollback;
