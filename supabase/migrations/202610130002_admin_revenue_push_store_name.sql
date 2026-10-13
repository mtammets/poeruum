-- Keep the shop name alongside the fee snapshot, including across retries.
alter table public.admin_push_jobs add column store_name text;

update public.admin_push_jobs job
set store_name = coalesce(nullif(btrim(store.name), ''), 'Pood')
from public.revenue_events event
left join public.stores store on store.id = event.store_id
where job.kind = 'revenue' and job.event_id = event.id;

create or replace function public.enqueue_admin_revenue_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare store_name_value text;
begin
  if new.amount_cents <= 0 or new.kind not in ('transaction_fee', 'subscription')
    or new.metadata->>'livemode' = 'false'
    or new.metadata->>'stripe_mode' = 'test'
    or new.metadata->>'billing_adjustment' is not null
    or exists (select 1 from public.orders payment
      where payment.id::text = new.metadata->>'order_id' and payment.stripe_mode = 'test')
  then return null; end if;

  select store.name into store_name_value from public.stores store where store.id = new.store_id;
  store_name_value := coalesce(nullif(btrim(store_name_value), ''), 'Pood');
  insert into public.admin_push_jobs(subscription_id, event_id, kind, amount_cents, currency, store_name)
  select subscription.id, new.id, 'revenue', new.amount_cents, new.currency, store_name_value
  from public.admin_push_subscriptions subscription
  join auth.users users on users.id = subscription.user_id
  where users.raw_app_meta_data->>'role' = 'admin' and subscription.revenue_enabled
  on conflict do nothing;
  if found then perform public.dispatch_admin_push(); end if;
  return null;
end;
$$;
revoke all on function public.enqueue_admin_revenue_push() from public, anon, authenticated;

-- Changing the private claim result requires recreating the function and grants.
drop function public.claim_admin_push_job();
create function public.claim_admin_push_job()
returns table(id uuid, lease_token uuid, subscription_id uuid, endpoint text, p256dh text, auth text, kind text, amount_cents integer, currency text, store_name text)
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
    claimed.amount_cents, claimed.currency, claimed.store_name
  from public.admin_push_subscriptions subscription where subscription.id = claimed.subscription_id;
end;
$$;
revoke all on function public.claim_admin_push_job() from public, anon, authenticated;
grant execute on function public.claim_admin_push_job() to service_role;
