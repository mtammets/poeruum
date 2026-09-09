create table public.order_email_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null check (kind in ('customer', 'seller')),
  stripe_mode text not null check (stripe_mode in ('test', 'live')),
  status text not null default 'pending' check (status in ('pending','processing','retry','accepted','skipped','needs_review')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  payload jsonb,
  first_attempt_at timestamptz,
  resend_email_id text unique,
  accepted_at timestamptz,
  delivered_at timestamptz,
  delivery_status text check (delivery_status in ('sent','delivery_delayed','delivered','failed','bounced','complained','suppressed')),
  delivery_event_at timestamptz,
  last_error text,
  legacy_import boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, kind)
);
create index order_email_jobs_due_idx on public.order_email_jobs(stripe_mode, next_attempt_at)
  where status in ('pending','processing','retry');
create trigger order_email_jobs_updated_at before update on public.order_email_jobs
  for each row execute function public.set_updated_at();
alter table public.order_email_jobs enable row level security;
revoke all on public.order_email_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.order_email_jobs to service_role;

create function public.enqueue_paid_order_emails()
returns trigger language plpgsql security definer set search_path = '' as $$
declare settings_value jsonb;
begin
  if new.payment_status <> 'paid' or new.stripe_mode is null or new.stripe_payment_intent_id is null then return new; end if;
  select settings into settings_value from public.stores where id = new.store_id;
  insert into public.order_email_jobs(order_id, kind, stripe_mode, status, accepted_at)
  select new.id, email.kind, new.stripe_mode,
    case when email.sent_at is not null then 'accepted'
      when settings_value -> email.setting_key = 'false'::jsonb then 'skipped' else 'pending' end,
    email.sent_at
  from (values ('customer', 'customerConfirmations', new.customer_confirmation_sent_at),
    ('seller', 'sellerNotifications', new.seller_notification_sent_at)) email(kind, setting_key, sent_at)
  on conflict (order_id, kind) do nothing;
  return new;
end;
$$;
revoke all on function public.enqueue_paid_order_emails() from public, anon, authenticated;
create trigger orders_enqueue_emails after insert or update of payment_status, stripe_payment_intent_id on public.orders
  for each row execute function public.enqueue_paid_order_emails();

-- Historical missing timestamps can mean a send succeeded but its DB update
-- failed. Do not automatically resend those messages after provider dedup expires.
insert into public.order_email_jobs(order_id, kind, stripe_mode, status, accepted_at, legacy_import, last_error)
select payment.id, email.kind, payment.stripe_mode,
  case when email.sent_at is not null then 'accepted'
    when store.settings -> email.setting_key = 'false'::jsonb then 'skipped' else 'needs_review' end,
  email.sent_at, true,
  case when email.sent_at is null and store.settings -> email.setting_key is distinct from 'false'::jsonb
    then 'Varasema kirja saatmist tuleb enne kordussaatmist kontrollida.' end
from public.orders payment join public.stores store on store.id = payment.store_id
cross join lateral (values ('customer', 'customerConfirmations', payment.customer_confirmation_sent_at),
  ('seller', 'sellerNotifications', payment.seller_notification_sent_at)) email(kind, setting_key, sent_at)
where payment.payment_status = 'paid' and payment.stripe_payment_intent_id is not null and payment.stripe_mode is not null
on conflict (order_id, kind) do nothing;

create function public.claim_order_email_job(mode_value text, target_order_id uuid default null, kind_value text default null)
returns setof public.order_email_jobs language plpgsql security definer set search_path = '' as $$
declare job_id uuid;
begin
  if mode_value is null or mode_value not in ('test','live') then raise exception 'INVALID_STRIPE_MODE'; end if;
  if kind_value is not null and kind_value not in ('customer','seller') then raise exception 'INVALID_EMAIL_KIND'; end if;
  select job.id into job_id from public.order_email_jobs job
  where job.stripe_mode = mode_value and job.status in ('pending','processing','retry')
    and (target_order_id is null or job.order_id = target_order_id)
    and (kind_value is null or job.kind = kind_value)
    and job.next_attempt_at <= now()
    and (job.lease_expires_at is null or job.lease_expires_at <= now())
  order by job.next_attempt_at, job.created_at, job.kind
  for update skip locked limit 1;
  if job_id is null then return; end if;
  return query update public.order_email_jobs set status = 'processing', attempts = attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + interval '2 minutes'
    where id = job_id returning *;
end;
$$;

create function public.prepare_order_email_send(target_job_id uuid, token_value uuid, payload_value jsonb default null)
returns public.order_email_jobs language plpgsql security definer set search_path = '' as $$
declare job public.order_email_jobs%rowtype; payment public.orders%rowtype; settings_value jsonb; enabled boolean; legacy_sent_at timestamptz;
begin
  select * into job from public.order_email_jobs where id = target_job_id for update;
  if not found or token_value is null or job.lease_token is distinct from token_value
    or job.lease_expires_at is null or job.lease_expires_at <= now() then raise exception 'EMAIL_LEASE_LOST'; end if;
  if job.resend_email_id is not null then return job; end if;
  select * into payment from public.orders where id = job.order_id;
  legacy_sent_at := case job.kind when 'customer' then payment.customer_confirmation_sent_at else payment.seller_notification_sent_at end;
  if legacy_sent_at is not null then
    update public.order_email_jobs set status = 'accepted', accepted_at = legacy_sent_at, legacy_import = true
      where id = job.id returning * into job;
    return job;
  end if;
  select settings into settings_value from public.stores where id = payment.store_id;
  enabled := settings_value -> (case job.kind when 'customer' then 'customerConfirmations' else 'sellerNotifications' end)
    is distinct from 'false'::jsonb;
  if payment.payment_status <> 'paid' or not enabled then
    update public.order_email_jobs set
      status = case when payload is null then 'skipped' else 'needs_review' end,
      last_error = case when payload is null then 'Kiri ei ole enam vajalik.' else 'Varasema saatmiskatse tulemus vajab kontrolli.' end
      where id = job.id returning * into job;
    return job;
  end if;
  if job.payload is null then
    if payload_value is null then return job; end if; -- Eligibility/lease check before rendering.
    if jsonb_typeof(payload_value) is distinct from 'object'
      or jsonb_typeof(payload_value -> 'to') is distinct from 'array'
      or jsonb_array_length(payload_value -> 'to') <> 1
      or coalesce(payload_value #>> '{to,0}', '') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or nullif(payload_value ->> 'from', '') is null
      or nullif(payload_value ->> 'subject', '') is null
      or nullif(payload_value ->> 'html', '') is null
      or not coalesce(payload_value -> 'tags' @> jsonb_build_array(
        jsonb_build_object('name','order_id','value',job.order_id::text),
        jsonb_build_object('name','order_email_job_id','value',job.id::text),
        jsonb_build_object('name','email_type','value',case job.kind when 'customer' then 'order_customer_confirmation' else 'order_seller_notification' end)), false)
    then raise exception 'INVALID_EMAIL_PAYLOAD'; end if;
    if job.kind = 'customer' and lower(payload_value #>> '{to,0}') <> lower(payment.customer_email) then
      raise exception 'EMAIL_RECIPIENT_MISMATCH';
    end if;
    update public.order_email_jobs set payload = payload_value, first_attempt_at = now()
      where id = job.id returning * into job;
  end if;
  return job;
end;
$$;

create function public.finish_order_email_job(target_job_id uuid, token_value uuid, outcome_value text,
  email_id_value text default null, error_value text default null)
returns public.order_email_jobs language plpgsql security definer set search_path = '' as $$
declare job public.order_email_jobs%rowtype; oid uuid;
begin
  -- Same lock order as payment confirmation and delivery callbacks.
  select order_id into oid from public.order_email_jobs where id = target_job_id;
  perform 1 from public.orders where id = oid for update;
  select * into job from public.order_email_jobs where id = target_job_id for update;
  if not found or token_value is null or job.lease_token is distinct from token_value
    or job.lease_expires_at is null or job.lease_expires_at <= now() then raise exception 'EMAIL_LEASE_LOST'; end if;
  if outcome_value is null or outcome_value not in ('accepted','retry','skipped','needs_review') then raise exception 'INVALID_EMAIL_OUTCOME'; end if;
  if email_id_value is not null and job.resend_email_id is not null and email_id_value <> job.resend_email_id then
    raise exception 'EMAIL_PROVIDER_ID_MISMATCH';
  end if;
  -- A webhook may have confirmed delivery while the HTTP send was timing out.
  if job.resend_email_id is not null then outcome_value := 'accepted'; end if;
  if outcome_value = 'accepted' and not (job.legacy_import and job.accepted_at is not null and job.resend_email_id is null) then
    email_id_value := coalesce(job.resend_email_id, nullif(btrim(email_id_value), ''));
    if email_id_value is null or job.payload is null then raise exception 'EMAIL_ACCEPTANCE_REFERENCE_REQUIRED'; end if;
    update public.order_email_jobs set resend_email_id = email_id_value, accepted_at = coalesce(accepted_at, now()),
      delivery_status = coalesce(delivery_status, 'sent') where id = job.id returning * into job;
    update public.orders set
      customer_confirmation_sent_at = case when job.kind = 'customer' then coalesce(customer_confirmation_sent_at, job.accepted_at) else customer_confirmation_sent_at end,
      seller_notification_sent_at = case when job.kind = 'seller' then coalesce(seller_notification_sent_at, job.accepted_at) else seller_notification_sent_at end
      where id = job.order_id;
    insert into public.email_deliveries(resend_email_id, recipient_email, subject, email_type, status, sent_at, status_updated_at)
    values (email_id_value, lower(job.payload #>> '{to,0}'), job.payload ->> 'subject',
      case job.kind when 'customer' then 'order_customer_confirmation' else 'order_seller_notification' end,
      job.delivery_status, job.accepted_at, coalesce(job.delivery_event_at, job.accepted_at))
    on conflict (resend_email_id) do nothing;
  end if;
  update public.order_email_jobs set status = outcome_value, lease_token = null, lease_expires_at = null,
    last_error = case when outcome_value = 'accepted' then null else coalesce(left(error_value, 500), last_error) end,
    next_attempt_at = now() + make_interval(secs => least(3600, 15 * power(2, least(attempts,8))::integer))
    where id = job.id returning * into job;
  return job;
end;
$$;

alter table public.email_deliveries drop constraint email_deliveries_status_check;
alter table public.email_deliveries add constraint email_deliveries_status_check
  check (status in ('sent','delivery_delayed','delivered','failed','bounced','complained','suppressed'));

create function public.record_order_email_delivery(target_job_id uuid, order_id_value uuid, kind_value text,
  event_id_value text, email_id_value text, recipient_value text, status_value text, occurred_at_value timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.order_email_jobs%rowtype; inserted integer; apply_status boolean;
begin
  if status_value is null or status_value not in ('sent','delivery_delayed','delivered','failed','bounced','complained','suppressed')
    or nullif(btrim(event_id_value),'') is null or nullif(btrim(email_id_value),'') is null or occurred_at_value is null then
    raise exception 'INVALID_EMAIL_EVENT';
  end if;
  perform 1 from public.orders where id = order_id_value for update;
  select * into job from public.order_email_jobs where id = target_job_id and order_id = order_id_value and kind = kind_value for update;
  if not found or job.payload is null then return false; end if;
  if lower(recipient_value) is distinct from lower(job.payload #>> '{to,0}')
    or (job.resend_email_id is not null and job.resend_email_id <> email_id_value) then
    raise exception 'EMAIL_EVENT_MISMATCH';
  end if;
  -- Receipt and business outcome share one transaction, including early webhooks.
  insert into public.resend_webhook_events(id, event_type) values (event_id_value, 'email.' || status_value)
    on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return true; end if;
  apply_status := (job.delivery_event_at is null or occurred_at_value >= job.delivery_event_at)
    and (job.delivery_status is null or job.delivery_status in ('sent','delivery_delayed')
      or status_value in ('delivered','failed','bounced','complained','suppressed'))
    and (job.delivery_status is distinct from 'complained' or status_value = 'complained');
  update public.order_email_jobs set status = 'accepted', resend_email_id = email_id_value,
    accepted_at = coalesce(accepted_at, occurred_at_value), last_error = null,
    delivery_status = case when apply_status then status_value else delivery_status end,
    delivery_event_at = case when apply_status then occurred_at_value else delivery_event_at end,
    delivered_at = case when status_value = 'delivered' then coalesce(delivered_at, occurred_at_value) else delivered_at end
    where id = job.id returning * into job;
  update public.orders set
    customer_confirmation_sent_at = case when job.kind = 'customer' then coalesce(customer_confirmation_sent_at, job.accepted_at) else customer_confirmation_sent_at end,
    seller_notification_sent_at = case when job.kind = 'seller' then coalesce(seller_notification_sent_at, job.accepted_at) else seller_notification_sent_at end
    where id = job.order_id;
  insert into public.email_deliveries(resend_email_id, recipient_email, subject, email_type, status, sent_at, status_updated_at)
  values (email_id_value, lower(job.payload #>> '{to,0}'), job.payload ->> 'subject',
    case job.kind when 'customer' then 'order_customer_confirmation' else 'order_seller_notification' end,
    job.delivery_status, job.accepted_at, job.delivery_event_at)
  on conflict (resend_email_id) do update set status = excluded.status, status_updated_at = excluded.status_updated_at;
  return true;
end;
$$;

revoke all on function public.claim_order_email_job(text,uuid,text) from public, anon, authenticated;
revoke all on function public.prepare_order_email_send(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.finish_order_email_job(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.record_order_email_delivery(uuid,uuid,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_order_email_job(text,uuid,text) to service_role;
grant execute on function public.prepare_order_email_send(uuid,uuid,jsonb) to service_role;
grant execute on function public.finish_order_email_job(uuid,uuid,text,text,text) to service_role;
grant execute on function public.record_order_email_delivery(uuid,uuid,text,text,text,text,text,timestamptz) to service_role;

do $$
declare existing_job bigint; reminder_url text;
begin
  select jobid into existing_job from cron.job where jobname = 'poeruum-order-emails';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  select decrypted_secret into reminder_url from vault.decrypted_secrets where name = 'onboarding_reminders_url' limit 1;
  if reminder_url is null or position('/onboarding-reminders' in reminder_url) = 0
    or not exists(select 1 from vault.decrypted_secrets where name = 'onboarding_cron_secret' and nullif(trim(decrypted_secret),'') is not null) then
    raise notice 'Order email schedule skipped because Vault secrets are not configured.'; return;
  end if;
  perform cron.schedule('poeruum-order-emails', '* * * * *', $schedule$
    select net.http_post(
      url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_reminders_url' limit 1), '/onboarding-reminders', '/order-emails'),
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'onboarding_cron_secret' limit 1)),
      body := '{}'::jsonb, timeout_milliseconds := 120000
    );
  $schedule$);
end;
$$;
