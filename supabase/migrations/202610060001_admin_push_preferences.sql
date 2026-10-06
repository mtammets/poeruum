-- Existing devices keep both notification categories enabled.
alter table public.admin_push_subscriptions
  add column visits_enabled boolean not null default true,
  add column accounts_enabled boolean not null default true;

create or replace function public.enqueue_admin_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare notice_kind text := tg_argv[0];
begin
  insert into public.admin_push_jobs(subscription_id, event_id, kind)
  select subscription.id, new.id, notice_kind
  from public.admin_push_subscriptions subscription
  join auth.users users on users.id = subscription.user_id
  where users.raw_app_meta_data ->> 'role' = 'admin'
    and ((notice_kind = 'visit' and subscription.visits_enabled)
      or (notice_kind = 'account' and subscription.accounts_enabled))
  on conflict do nothing;
  if found then perform public.dispatch_admin_push(); end if;
  return null;
end;
$$;
-- Muting a category also removes its pending retries for this device.
create function public.prune_admin_push_preferences()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.admin_push_jobs job where job.subscription_id = new.id
    and ((job.kind = 'visit' and not new.visits_enabled)
      or (job.kind = 'account' and not new.accounts_enabled));
  return null;
end;
$$;
revoke all on function public.prune_admin_push_preferences() from public, anon, authenticated;
create trigger admin_push_preferences_changed
  after update of visits_enabled, accounts_enabled on public.admin_push_subscriptions
  for each row execute function public.prune_admin_push_preferences();

create or replace function public.claim_admin_push_job()
returns table(id uuid, lease_token uuid, subscription_id uuid, endpoint text, p256dh text, auth text, kind text)
language plpgsql security definer set search_path = '' as $$
declare claimed public.admin_push_jobs%rowtype;
begin
  -- Revoked admin access stops delivery even if an old browser JWT still exists.
  delete from public.admin_push_subscriptions subscription
  where not exists (select 1 from auth.users users where users.id = subscription.user_id and users.raw_app_meta_data ->> 'role' = 'admin');
  delete from public.admin_push_jobs job where job.created_at < now() - interval '1 hour'
    or (job.attempts >= 5 and job.available_at <= now())
    or exists (select 1 from public.admin_push_subscriptions subscription
      where subscription.id = job.subscription_id
        and ((job.kind = 'visit' and not subscription.visits_enabled)
          or (job.kind = 'account' and not subscription.accounts_enabled)));
  select job.* into claimed from public.admin_push_jobs job
  where job.available_at <= now() and job.attempts < 5
  order by job.created_at limit 1 for update skip locked;
  if not found then return; end if;
  update public.admin_push_jobs job set attempts = attempts + 1,
    available_at = now() + interval '2 minutes', lease_token = gen_random_uuid()
  where job.id = claimed.id returning job.* into claimed;
  return query select claimed.id, claimed.lease_token, subscription.id,
    subscription.endpoint, subscription.p256dh, subscription.auth, claimed.kind
  from public.admin_push_subscriptions subscription where subscription.id = claimed.subscription_id;
end;
$$;

