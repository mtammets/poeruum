-- Snapshot confirmed revenue in the private queue so retries keep the same amount.
alter table public.admin_push_subscriptions
  add column revenue_enabled boolean not null default true;

alter table public.admin_push_jobs
  add column amount_cents integer,
  add column currency text;
alter table public.admin_push_jobs drop constraint admin_push_jobs_kind_check;
alter table public.admin_push_jobs add constraint admin_push_jobs_kind_check
  check (kind in ('visit', 'account', 'support', 'revenue'));
alter table public.admin_push_jobs add constraint admin_push_jobs_revenue_check
  check ((kind = 'revenue' and amount_cents is not null and amount_cents > 0
    and currency is not null and currency ~ '^[a-z]{3}$')
    or (kind <> 'revenue' and amount_cents is null and currency is null));

create function public.enqueue_admin_revenue_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Match the admin revenue dashboard's live-payment filters. Refunds and
  -- credit notes are adjustments, not new fee receipts.
  if new.amount_cents <= 0 or new.kind not in ('transaction_fee', 'subscription')
    or new.metadata->>'livemode' = 'false'
    or new.metadata->>'stripe_mode' = 'test'
    or new.metadata->>'billing_adjustment' is not null
    or exists (select 1 from public.orders payment
      where payment.id::text = new.metadata->>'order_id' and payment.stripe_mode = 'test')
  then return null; end if;

  insert into public.admin_push_jobs(subscription_id, event_id, kind, amount_cents, currency)
  select subscription.id, new.id, 'revenue', new.amount_cents, new.currency
  from public.admin_push_subscriptions subscription
  join auth.users users on users.id = subscription.user_id
  where users.raw_app_meta_data->>'role' = 'admin' and subscription.revenue_enabled
  on conflict do nothing;
  if found then perform public.dispatch_admin_push(); end if;
  return null;
end;
$$;
revoke all on function public.enqueue_admin_revenue_push() from public, anon, authenticated;
create trigger admin_push_after_revenue after insert on public.revenue_events
  for each row execute function public.enqueue_admin_revenue_push();

create or replace function public.prune_admin_push_preferences()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.admin_push_jobs job where job.subscription_id = new.id
    and ((job.kind = 'visit' and not new.visits_enabled)
      or (job.kind = 'account' and not new.accounts_enabled)
      or (job.kind = 'support' and not new.support_enabled)
      or (job.kind = 'revenue' and not new.revenue_enabled));
  return null;
end;
$$;
drop trigger admin_push_preferences_changed on public.admin_push_subscriptions;
create trigger admin_push_preferences_changed
  after update of visits_enabled, accounts_enabled, support_enabled, revenue_enabled on public.admin_push_subscriptions
  for each row execute function public.prune_admin_push_preferences();

-- The return shape gains the amount snapshot. Restore the private RPC grants
-- explicitly after replacing the function; browsers must never claim jobs.
drop function public.claim_admin_push_job();
create function public.claim_admin_push_job()
returns table(id uuid, lease_token uuid, subscription_id uuid, endpoint text, p256dh text, auth text, kind text, amount_cents integer, currency text)
language plpgsql security definer set search_path = '' as $$
declare claimed public.admin_push_jobs%rowtype;
begin
  delete from public.admin_push_subscriptions subscription
  where not exists (select 1 from auth.users users where users.id = subscription.user_id and users.raw_app_meta_data->>'role' = 'admin');
  delete from public.admin_push_jobs job where job.created_at < now() - interval '1 hour'
    or (job.attempts >= 5 and job.available_at <= now())
    or exists (select 1 from public.admin_push_subscriptions subscription
      where subscription.id = job.subscription_id
        and ((job.kind = 'visit' and not subscription.visits_enabled)
          or (job.kind = 'account' and not subscription.accounts_enabled)
          or (job.kind = 'support' and not subscription.support_enabled)
          or (job.kind = 'revenue' and not subscription.revenue_enabled)));
  select job.* into claimed from public.admin_push_jobs job
  where job.available_at <= now() and job.attempts < 5
  order by job.created_at limit 1 for update skip locked;
  if not found then return; end if;
  update public.admin_push_jobs job set attempts = attempts + 1,
    available_at = now() + interval '2 minutes', lease_token = gen_random_uuid()
  where job.id = claimed.id returning job.* into claimed;
  return query select claimed.id, claimed.lease_token, subscription.id,
    subscription.endpoint, subscription.p256dh, subscription.auth, claimed.kind,
    claimed.amount_cents, claimed.currency
  from public.admin_push_subscriptions subscription where subscription.id = claimed.subscription_id;
end;
$$;
revoke all on function public.claim_admin_push_job() from public, anon, authenticated;
grant execute on function public.claim_admin_push_job() to service_role;
