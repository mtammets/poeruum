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
    '81000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'stripe-reminder@example.invalid',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '81000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'stripe-pending@example.invalid',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '81000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'stripe-unconfirmed@example.invalid',
    null,
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
  payment_status,
  stripe_account_id,
  stripe_account_charges_enabled,
  stripe_account_payouts_enabled,
  stripe_account_requirements_due_count,
  stripe_account_requirements_past_due,
  stripe_account_requirements_deadline,
  stripe_account_requirements_pending_verification,
  shipping,
  settings
) values
  (
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'Stripe reminder store',
    'stripe-reminder-store',
    'connected',
    'acct_requirement_reminder',
    true,
    true,
    2,
    false,
    now() + interval '20 days',
    false,
    '{}'::text[],
    '{}'::jsonb
  ),
  (
    '82000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000002',
    'Stripe pending store',
    'stripe-pending-store',
    'connected',
    'acct_requirement_pending',
    true,
    true,
    0,
    false,
    null,
    true,
    '{}'::text[],
    '{}'::jsonb
  ),
  (
    '82000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000003',
    'Stripe unconfirmed store',
    'stripe-unconfirmed-store',
    'connected',
    'acct_requirement_unconfirmed',
    true,
    true,
    0,
    false,
    null,
    false,
    '{}'::text[],
    '{}'::jsonb
  );

-- An existing actionable state and a pending-verification-only state are both
-- silent baselines. Neither may be leased after deployment.
update public.stripe_requirement_notification_state
set episode_started_at = now() - interval '10 days',
    action_required_sent_at = now() - interval '2 days'
where store_id = '82000000-0000-4000-8000-000000000001';

do $$
declare
  claim_count integer;
begin
  select count(*) into claim_count
  from public.claim_stripe_requirement_notification();
  if claim_count <> 0 then
    raise exception 'TEST_BASELINE_REQUIREMENT_WAS_NOT_SUPPRESSED';
  end if;

  if not exists (
    select 1
    from public.stripe_requirement_notification_state
    where store_id = '82000000-0000-4000-8000-000000000001'
      and episode_id is not null
      and episode_suppressed
  ) then
    raise exception 'TEST_ACTIONABLE_BASELINE_NOT_RECORDED';
  end if;

  if not exists (
    select 1
    from public.stripe_requirement_notification_state
    where store_id = '82000000-0000-4000-8000-000000000002'
      and episode_id is null
  ) then
    raise exception 'TEST_PENDING_ONLY_STATE_BECAME_ACTIONABLE';
  end if;
end;
$$;

-- Baseline suppression covers the immediate action email only. A requirement
-- that remains open can still receive the later deadline reminders.
update public.stores
set stripe_account_requirements_deadline = now() + interval '6 days'
where id = '82000000-0000-4000-8000-000000000001';

do $$
declare claim record;
begin
  select * into claim
  from public.claim_stripe_requirement_notification();
  if claim.kind is distinct from 'deadline_7d' then
    raise exception 'TEST_BASELINE_SEVEN_DAY_REMINDER_NOT_CLAIMED: %', row_to_json(claim);
  end if;
  if not public.complete_stripe_requirement_notification(claim.notification_id) then
    raise exception 'TEST_BASELINE_SEVEN_DAY_REMINDER_NOT_COMPLETED';
  end if;
end;
$$;

-- Resolving the baseline and later becoming actionable creates a new,
-- emailable episode. Its first email is debounced for 15 minutes.
update public.stores
set stripe_account_requirements_due_count = 0,
    stripe_account_requirements_past_due = false,
    stripe_account_requirements_deadline = null
where id = '82000000-0000-4000-8000-000000000001';

update public.stores
set stripe_account_requirements_due_count = 2,
    stripe_account_requirements_deadline = now() + interval '10 days'
where id = '82000000-0000-4000-8000-000000000001';

do $$
declare
  claim_count integer;
begin
  select count(*) into claim_count
  from public.claim_stripe_requirement_notification();
  if claim_count <> 0 then
    raise exception 'TEST_ACTION_REQUIRED_DEBOUNCE_FAILED';
  end if;
end;
$$;

update public.stripe_requirement_notification_state
set episode_started_at = now() - interval '2 days'
where store_id = '82000000-0000-4000-8000-000000000001';

do $$
declare
  first_claim record;
  retry_claim record;
begin
  select * into first_claim
  from public.claim_stripe_requirement_notification();

  if first_claim.kind is distinct from 'action_required'
    or first_claim.store_id is distinct from '82000000-0000-4000-8000-000000000001'::uuid
    or first_claim.email is distinct from 'stripe-reminder@example.invalid'
    or first_claim.due_count is distinct from 2
    or first_claim.past_due
    or first_claim.disabled
  then
    raise exception 'TEST_UNEXPECTED_ACTION_REQUIRED_CLAIM: %', row_to_json(first_claim);
  end if;

  if not public.release_stripe_requirement_notification(first_claim.notification_id) then
    raise exception 'TEST_ACTION_REQUIRED_RELEASE_FAILED';
  end if;

  if exists (select 1 from public.claim_stripe_requirement_notification()) then
    raise exception 'TEST_RELEASE_BACKOFF_DID_NOT_BLOCK_IMMEDIATE_RETRY';
  end if;

  update public.stripe_requirement_notification_state
  set claim_expires_at = now() - interval '1 second'
  where claimed_notification_id = first_claim.notification_id;

  select * into retry_claim
  from public.claim_stripe_requirement_notification();
  if retry_claim.notification_id is distinct from first_claim.notification_id then
    raise exception 'TEST_NOTIFICATION_ID_CHANGED_AFTER_RETRY';
  end if;

  if not public.complete_stripe_requirement_notification(retry_claim.notification_id) then
    raise exception 'TEST_ACTION_REQUIRED_COMPLETE_FAILED';
  end if;
  if public.complete_stripe_requirement_notification(retry_claim.notification_id) then
    raise exception 'TEST_ACTION_REQUIRED_COMPLETED_TWICE';
  end if;
end;
$$;

-- Entering the seven-day window produces one reminder only when the episode
-- existed before that threshold and the initial email is at least 12h old.
update public.stores
set stripe_account_requirements_deadline = now() + interval '6 days'
where id = '82000000-0000-4000-8000-000000000001';
update public.stripe_requirement_notification_state
set episode_started_at = now() - interval '10 days',
    action_required_sent_at = now() - interval '2 days'
where store_id = '82000000-0000-4000-8000-000000000001';

do $$
declare claim record;
begin
  select * into claim
  from public.claim_stripe_requirement_notification();
  if claim.kind is distinct from 'deadline_7d' then
    raise exception 'TEST_SEVEN_DAY_REMINDER_NOT_CLAIMED: %', row_to_json(claim);
  end if;
  if not public.complete_stripe_requirement_notification(claim.notification_id) then
    raise exception 'TEST_SEVEN_DAY_REMINDER_NOT_COMPLETED';
  end if;
end;
$$;

-- The one-day window is separate. A disabled capability is exposed only as a
-- boolean; the raw Stripe disabled reason never leaves the claim RPC.
update public.stores
set stripe_account_requirements_deadline = now() + interval '20 hours',
    stripe_account_payouts_enabled = false,
    stripe_account_requirements_past_due = true,
    stripe_account_requirements_disabled_reason = 'requirements.past_due'
where id = '82000000-0000-4000-8000-000000000001';
update public.stripe_requirement_notification_state
set action_required_sent_at = now() - interval '3 days',
    deadline_7d_sent_at = now() - interval '2 days'
where store_id = '82000000-0000-4000-8000-000000000001';

do $$
declare claim record;
begin
  select * into claim
  from public.claim_stripe_requirement_notification();
  if claim.kind is distinct from 'deadline_1d'
    or not claim.past_due
    or not claim.disabled
  then
    raise exception 'TEST_ONE_DAY_REMINDER_NOT_CLAIMED: %', row_to_json(claim);
  end if;
  if not public.complete_stripe_requirement_notification(claim.notification_id) then
    raise exception 'TEST_ONE_DAY_REMINDER_NOT_COMPLETED';
  end if;
end;
$$;

-- A disabled reason without pending verification is actionable even if Stripe
-- reports no due fields. It must expose only the derived disabled boolean.
update public.stores
set stripe_account_requirements_pending_verification = false,
    stripe_account_requirements_disabled_reason = 'requirements.past_due'
where id = '82000000-0000-4000-8000-000000000002';
update public.stripe_requirement_notification_state
set episode_started_at = now() - interval '2 days'
where store_id = '82000000-0000-4000-8000-000000000002';

do $$
declare claim record;
begin
  select * into claim
  from public.claim_stripe_requirement_notification();
  if claim.kind is distinct from 'action_required'
    or claim.due_count is distinct from 0
    or claim.past_due
    or not claim.disabled
  then
    raise exception 'TEST_DISABLED_ONLY_REQUIREMENT_NOT_CLAIMED: %', row_to_json(claim);
  end if;
  if not public.complete_stripe_requirement_notification(claim.notification_id) then
    raise exception 'TEST_DISABLED_ONLY_REQUIREMENT_NOT_COMPLETED';
  end if;
end;
$$;

-- An unconfirmed owner can have an actionable episode, but never a claim.
update public.stores
set stripe_account_requirements_due_count = 1,
    stripe_account_requirements_deadline = now() + interval '20 days'
where id = '82000000-0000-4000-8000-000000000003';
update public.stripe_requirement_notification_state
set episode_started_at = now() - interval '2 days'
where store_id = '82000000-0000-4000-8000-000000000003';

do $$
declare claim_count integer;
begin
  select count(*) into claim_count
  from public.claim_stripe_requirement_notification();
  if claim_count <> 0 then
    raise exception 'TEST_UNCONFIRMED_EMAIL_WAS_CLAIMED';
  end if;
end;
$$;

update public.stores
set owner_id = null
where id = '82000000-0000-4000-8000-000000000001';
delete from public.stores
where id = '82000000-0000-4000-8000-000000000002';

do $$
begin
  if exists (
    select 1
    from public.stripe_requirement_notification_state
    where store_id in (
      '82000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000002'
    )
  ) then
    raise exception 'TEST_NOTIFICATION_STATE_CLEANUP_FAILED';
  end if;
end;
$$;

rollback;
