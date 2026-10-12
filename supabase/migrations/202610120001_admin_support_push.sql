-- Support notifications use the same private, per-device queue as visits/accounts.
alter table public.admin_push_subscriptions
  add column support_enabled boolean not null default true;

alter table public.admin_push_jobs drop constraint admin_push_jobs_kind_check;
alter table public.admin_push_jobs add constraint admin_push_jobs_kind_check
  check (kind in ('visit', 'account', 'support'));

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
      or (notice_kind = 'account' and subscription.accounts_enabled)
      or (notice_kind = 'support' and subscription.support_enabled))
  on conflict do nothing;
  if found then perform public.dispatch_admin_push(); end if;
  return null;
end;
$$;

-- Both app requests and inbound emails create user messages. Replies count too;
-- admin replies, outbound conversations and internal/system notes do not.
create trigger admin_push_after_support_message after insert on public.support_messages
  for each row when (new.sender_kind = 'user' and not new.is_internal)
  execute function public.enqueue_admin_push('support');

create or replace function public.prune_admin_push_preferences()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.admin_push_jobs job where job.subscription_id = new.id
    and ((job.kind = 'visit' and not new.visits_enabled)
      or (job.kind = 'account' and not new.accounts_enabled)
      or (job.kind = 'support' and not new.support_enabled));
  return null;
end;
$$;
drop trigger admin_push_preferences_changed on public.admin_push_subscriptions;
create trigger admin_push_preferences_changed
  after update of visits_enabled, accounts_enabled, support_enabled on public.admin_push_subscriptions
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
          or (job.kind = 'account' and not subscription.accounts_enabled)
          or (job.kind = 'support' and not subscription.support_enabled)));
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
