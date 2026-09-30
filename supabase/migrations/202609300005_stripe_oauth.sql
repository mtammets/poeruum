-- Private, short-lived authorization attempts. Only the Edge Function can use them.
alter table public.stores add column if not exists stripe_connection_type text
  check (stripe_connection_type in ('managed', 'oauth'));
update public.stores set stripe_connection_type = 'managed' where stripe_account_id is not null and stripe_connection_type is null;

create table public.stripe_oauth_attempts (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  stripe_mode text not null check (stripe_mode in ('test','live')),
  settings_snapshot jsonb not null,
  expires_at timestamptz not null default now() + interval '15 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.stripe_oauth_attempts enable row level security;
revoke all on public.stripe_oauth_attempts from public, anon, authenticated;
grant all on public.stripe_oauth_attempts to service_role;
create index on public.stripe_oauth_attempts(expires_at);

create function public.attach_stripe_oauth_account(target_state_hash text, target_owner_id uuid,
  target_account_id text, target_mode text, account_update jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare attempt public.stripe_oauth_attempts%rowtype; target public.stores%rowtype;
begin
  select * into attempt from public.stripe_oauth_attempts where state_hash=target_state_hash
    and owner_id=target_owner_id and stripe_mode=target_mode and consumed_at is not null
    and expires_at>now() for update;
  if not found then raise exception 'Ühendamise katse aegus. Alusta uuesti.'; end if;
  if target_account_id !~ '^acct_[a-zA-Z0-9]+$' then raise exception 'Stripe’i konto ei sobi.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_mode || ':' || target_account_id, 0));
  select * into target from public.stores where id=attempt.store_id and owner_id=target_owner_id for update;
  if not found then raise exception 'Poodi ei leitud.'; end if;
  if target.stripe_account_id is not null then raise exception 'Poel on juba ühendatud Stripe’i konto.'; end if;
  if target.settings is distinct from attempt.settings_snapshot then raise exception 'Müüja andmed muutusid. Alusta ühendamist uuesti.'; end if;
  if exists(select 1 from public.stores where stripe_account_id=target_account_id and stripe_account_mode=target_mode and id<>target.id) then
    raise exception 'See Stripe’i konto on juba teise poega ühendatud.';
  end if;
  update public.stores set stripe_account_id=target_account_id, stripe_account_mode=target_mode,
    stripe_connection_type='oauth', payment_provider='stripe',
    payment_status=case when account_update->>'ready'='true' then 'connected' else 'pending' end,
    stripe_account_charges_enabled=coalesce((account_update->>'chargesEnabled')::boolean,false),
    stripe_account_payouts_enabled=coalesce((account_update->>'payoutsEnabled')::boolean,false),
    stripe_account_requirements_due_count=coalesce((account_update->>'dueCount')::integer,0),
    stripe_account_requirements_past_due=coalesce((account_update->>'pastDue')::boolean,false),
    stripe_account_requirements_deadline=(account_update->>'currentDeadline')::timestamptz,
    stripe_account_requirements_pending_verification=coalesce((account_update->>'pendingVerification')::boolean,false),
    stripe_account_requirements_disabled_reason=account_update->>'disabledReason',
    stripe_account_requirement_issues=coalesce(account_update->'issues','[]'::jsonb),
    stripe_account_requirements_updated_at=now()
    where id=target.id;
  delete from public.stripe_oauth_attempts where store_id=target.id;
end; $$;
revoke all on function public.attach_stripe_oauth_account(text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.attach_stripe_oauth_account(text,uuid,text,text,jsonb) to service_role;
