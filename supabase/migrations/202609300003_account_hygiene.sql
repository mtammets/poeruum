-- Existing registrations receive at least seven days after rollout as well.
create table public.account_hygiene_settings (
  id boolean primary key default true check (id),
  introduced_at timestamptz not null default now()
);
insert into public.account_hygiene_settings default values;
alter table public.account_hygiene_settings enable row level security;
revoke all on public.account_hygiene_settings from public, anon, authenticated;
grant select on public.account_hygiene_settings to service_role;

-- Only never-used email registrations are eligible. Confirmed, banned, SSO,
-- anonymous and phone accounts, stores and any retained user data are excluded.
create function public.cleanup_unconfirmed_accounts(dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  candidates uuid[];
  removed integer := 0;
begin
  select coalesce(array_agg(candidate.id), '{}'::uuid[]) into candidates from (
    select account.id from auth.users account
    where account.created_at < now() - interval '7 days'
      and (select introduced_at from public.account_hygiene_settings where id) < now() - interval '7 days'
      and account.email is not null and account.email <> ''
      and account.email_confirmed_at is null and account.phone_confirmed_at is null
      and (account.confirmation_sent_at is null or account.confirmation_sent_at < now() - interval '7 days')
      and account.last_sign_in_at is null
      and coalesce(account.phone, '') = '' and coalesce(account.email_change, '') = ''
      and account.banned_until is null and account.deleted_at is null
      and not coalesce(account.is_anonymous, false) and not coalesce(account.is_sso_user, false)
      and coalesce(account.raw_app_meta_data ->> 'role', '') <> 'admin'
      and coalesce(account.raw_app_meta_data ->> 'provider', 'email') = 'email'
      and not exists (select 1 from auth.identities where user_id = account.id and provider <> 'email')
      and not exists (select 1 from auth.sessions where user_id = account.id)
      and not exists (select 1 from public.stores where owner_id = account.id)
      and not exists (select 1 from public.support_conversations where user_id = account.id or lower(external_email) = lower(account.email))
      and not exists (select 1 from public.support_messages where sender_user_id = account.id)
      and not exists (select 1 from public.admin_business_card_drafts where user_id = account.id)
      and not exists (select 1 from storage.objects where owner_id = account.id::text or owner = account.id)
      and not exists (select 1 from public.user_presence_sessions where user_id = account.id)
      and not exists (select 1 from public.onboarding_journeys where user_id = account.id
        and (store_id is not null or completed_at is not null or last_activity_at > created_at + interval '1 second'))
      and not exists (select 1 from public.sales_leads where created_by = account.id or updated_by = account.id)
    order by account.created_at
    limit 100
    for update of account skip locked
  ) candidate;
  if not dry_run then
    -- Locks serialize this deletion with Auth confirmation. All eligibility
    -- checks run in this same transaction; no client-side list/delete race.
    delete from auth.users where id = any(candidates);
    get diagnostics removed = row_count;
  end if;
  return jsonb_build_object('dry_run', dry_run, 'eligible', cardinality(candidates), 'deleted', removed);
end;
$$;
revoke all on function public.cleanup_unconfirmed_accounts(boolean) from public, anon, authenticated;
grant execute on function public.cleanup_unconfirmed_accounts(boolean) to service_role;
select cron.schedule('poeruum-unconfirmed-account-cleanup', '30 2 * * *',
  $cron$select public.cleanup_unconfirmed_accounts(false);$cron$);

-- Observe signup requests without recording raw IPs or rejecting visitors.
create table public.signup_observation_secret (
  id boolean primary key default true check (id),
  salt text not null default gen_random_uuid()::text
);
insert into public.signup_observation_secret default values;
create table public.signup_observations (
  id bigint generated always as identity primary key,
  network_hash text not null,
  created_at timestamptz not null default now()
);
create index signup_observations_network_time_idx on public.signup_observations(network_hash, created_at);
alter table public.signup_observation_secret enable row level security;
alter table public.signup_observations enable row level security;
revoke all on public.signup_observation_secret, public.signup_observations from public, anon, authenticated, service_role;

create function public.observe_signup(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  address inet;
  network_key text;
begin
  begin
    address := nullif(event #>> '{metadata,ip_address}', '')::inet;
  exception when invalid_text_representation then return '{}'::jsonb;
  end;
  if address is null then return '{}'::jsonb; end if;
  select encode(extensions.digest(host(address) || ':' || salt, 'sha256'), 'hex')
    into network_key from public.signup_observation_secret where id;
  insert into public.signup_observations(network_hash) values (network_key);
  return '{}'::jsonb;
end;
$$;
revoke all on function public.observe_signup(jsonb) from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.observe_signup(jsonb) to supabase_auth_admin;

create function public.admin_signup_alerts()
returns table (requests bigint, first_seen_at timestamptz, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  return query
  select count(*), min(created_at), max(created_at)
  from public.signup_observations where created_at > now() - interval '1 hour'
  group by network_hash having count(*) >= 5
  order by count(*) desc limit 20;
end;
$$;
revoke all on function public.admin_signup_alerts() from public, anon;
grant execute on function public.admin_signup_alerts() to authenticated;
select cron.schedule('poeruum-signup-observation-cleanup', '40 2 * * *',
  $cron$delete from public.signup_observations where created_at < now() - interval '30 days';$cron$);
