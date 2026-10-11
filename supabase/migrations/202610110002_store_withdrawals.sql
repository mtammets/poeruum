-- A withdrawal is a durable declaration, independent of payment/refund status.
-- Unmatched references are retained so an old order, changed email address or
-- partial return can never silently prevent the buyer from giving notice.
create table public.store_withdrawals (
  id uuid primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  order_reference text not null check (length(order_reference) between 1 and 120),
  customer_name text not null check (length(customer_name) between 1 and 120),
  customer_email text not null check (length(customer_email) <= 254 and customer_email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'),
  scope text not null default '' check (length(scope) <= 2000),
  statement text not null,
  store_name text not null,
  seller_email text not null,
  stripe_mode text not null check (stripe_mode in ('test', 'live')),
  submitted_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'reviewed')),
  reviewed_at timestamptz
);
create index store_withdrawals_store_idx on public.store_withdrawals(store_id, submitted_at desc);
alter table public.store_withdrawals enable row level security;
revoke all on public.store_withdrawals from public, anon, authenticated;
grant select on public.store_withdrawals to authenticated;
grant all on public.store_withdrawals to service_role;
create policy store_withdrawals_owner_read on public.store_withdrawals for select to authenticated
  using (exists (select 1 from public.stores where id = store_id and owner_id = auth.uid()));

create table public.withdrawal_email_jobs (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references public.store_withdrawals(id) on delete cascade,
  kind text not null check (kind in ('customer', 'seller')),
  stripe_mode text not null check (stripe_mode in ('test', 'live')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry', 'accepted', 'needs_review')),
  payload jsonb,
  first_attempt_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  resend_email_id text unique,
  accepted_at timestamptz,
  delivery_status text,
  delivery_event_at timestamptz,
  last_error text,
  unique (withdrawal_id, kind)
);
create index withdrawal_email_jobs_due_idx on public.withdrawal_email_jobs(stripe_mode, next_attempt_at)
  where status in ('pending', 'processing', 'retry');
alter table public.withdrawal_email_jobs enable row level security;
revoke all on public.withdrawal_email_jobs from public, anon, authenticated;
grant all on public.withdrawal_email_jobs to service_role;

create function public.submit_store_withdrawal(request_id uuid, target_store_id uuid, target_order_id uuid,
  reference_value text, name_value text, email_value text, scope_value text,
  store_name_value text, seller_email_value text, mode_value text)
returns public.store_withdrawals language plpgsql security definer set search_path = '' as $$
declare declaration public.store_withdrawals%rowtype;
begin
  if request_id is null or nullif(btrim(reference_value), '') is null or nullif(btrim(name_value), '') is null
    or email_value is null or scope_value is null or nullif(btrim(seller_email_value), '') is null
    or seller_email_value !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    or mode_value is null or mode_value not in ('test', 'live') then raise exception 'INVALID_WITHDRAWAL'; end if;
  if target_order_id is not null and not exists (select 1 from public.orders where id = target_order_id and store_id = target_store_id and stripe_mode = mode_value) then
    raise exception 'ORDER_STORE_MISMATCH';
  end if;
  insert into public.store_withdrawals(id, store_id, order_id, order_reference, customer_name, customer_email, scope,
    statement, store_name, seller_email, stripe_mode)
  values (request_id, target_store_id, target_order_id, reference_value, name_value, email_value, scope_value,
    'Taganen müügilepingust. Tellimus: ' || reference_value || '.' || E'\n' ||
      case when scope_value = '' then 'Taganemine puudutab kogu tellimust.' else 'Taganemine puudutab: ' || scope_value end,
    store_name_value, seller_email_value, mode_value)
  on conflict (id) do nothing;
  select * into declaration from public.store_withdrawals where id = request_id for update;
  if declaration.store_id is distinct from target_store_id or declaration.order_reference is distinct from reference_value
    or declaration.customer_name is distinct from name_value or declaration.customer_email is distinct from email_value
    or declaration.scope is distinct from scope_value or declaration.stripe_mode is distinct from mode_value then
    raise exception 'WITHDRAWAL_REQUEST_CHANGED';
  end if;
  insert into public.withdrawal_email_jobs(withdrawal_id, kind, stripe_mode)
    values (declaration.id, 'customer', declaration.stripe_mode), (declaration.id, 'seller', declaration.stripe_mode)
    on conflict (withdrawal_id, kind) do nothing;
  return declaration;
end;
$$;

-- Follow the existing account-deletion policy for customer working data.
-- Fiscal documents remain in their separate archive; these declarations and
-- queued payloads must not retain customer contacts in an orphaned shop.
create function public.remove_closed_account_withdrawals()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.store_withdrawals where store_id = old.id;
  return new;
end;
$$;
revoke all on function public.remove_closed_account_withdrawals() from public, anon, authenticated;
create trigger stores_remove_closed_account_withdrawals after update of owner_id on public.stores
  for each row when (old.owner_id is not null and new.owner_id is null)
  execute function public.remove_closed_account_withdrawals();

create function public.review_store_withdrawal(target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.store_withdrawals d set status = 'reviewed', reviewed_at = coalesce(reviewed_at, now())
    where d.id = target_id and exists (select 1 from public.stores s where s.id = d.store_id and s.owner_id = auth.uid());
  if not found then raise exception 'WITHDRAWAL_NOT_FOUND'; end if;
end;
$$;
revoke all on function public.review_store_withdrawal(uuid) from public, anon;
grant execute on function public.review_store_withdrawal(uuid) to authenticated;

create function public.claim_withdrawal_email(mode_value text, target_withdrawal_id uuid default null)
returns setof public.withdrawal_email_jobs language plpgsql security definer set search_path = '' as $$
declare job_id uuid;
begin
  select id into job_id from public.withdrawal_email_jobs
    where stripe_mode = mode_value and status in ('pending', 'processing', 'retry')
      and (target_withdrawal_id is null or withdrawal_id = target_withdrawal_id)
      and next_attempt_at <= now() and (lease_expires_at is null or lease_expires_at <= now())
    order by next_attempt_at, kind for update skip locked limit 1;
  if job_id is null then return; end if;
  return query update public.withdrawal_email_jobs set status = 'processing', attempts = attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + interval '2 minutes' where id = job_id returning *;
end;
$$;

create function public.prepare_withdrawal_email(target_job_id uuid, token_value uuid, payload_value jsonb default null)
returns public.withdrawal_email_jobs language plpgsql security definer set search_path = '' as $$
declare job public.withdrawal_email_jobs%rowtype; recipient text;
begin
  select * into job from public.withdrawal_email_jobs where id = target_job_id for update;
  if not found or token_value is null or job.lease_token is distinct from token_value or job.lease_expires_at is null or job.lease_expires_at <= now() then raise exception 'EMAIL_LEASE_LOST'; end if;
  if job.resend_email_id is not null then return job; end if;
  if job.payload is null and payload_value is not null then
    select case job.kind when 'customer' then customer_email else seller_email end into recipient from public.store_withdrawals where id = job.withdrawal_id;
    if jsonb_typeof(payload_value) is distinct from 'object' or jsonb_typeof(payload_value -> 'to') is distinct from 'array'
      or jsonb_array_length(payload_value -> 'to') <> 1 or lower(payload_value #>> '{to,0}') is distinct from lower(recipient)
      or nullif(payload_value ->> 'text', '') is null or nullif(payload_value ->> 'html', '') is null
      or nullif(payload_value ->> 'subject', '') is null or nullif(payload_value ->> 'from', '') is null
      or not coalesce(payload_value -> 'tags' @> jsonb_build_array(jsonb_build_object('name', 'withdrawal_email_job_id', 'value', job.id::text)), false)
      then raise exception 'INVALID_EMAIL_PAYLOAD'; end if;
    update public.withdrawal_email_jobs set payload = payload_value, first_attempt_at = now() where id = job.id returning * into job;
  end if;
  return job;
end;
$$;

create function public.finish_withdrawal_email(target_job_id uuid, token_value uuid, outcome_value text, email_id_value text default null, error_value text default null)
returns public.withdrawal_email_jobs language plpgsql security definer set search_path = '' as $$
declare job public.withdrawal_email_jobs%rowtype;
begin
  select * into job from public.withdrawal_email_jobs where id = target_job_id for update;
  if not found or token_value is null or job.lease_token is distinct from token_value or job.lease_expires_at is null or job.lease_expires_at <= now() then raise exception 'EMAIL_LEASE_LOST'; end if;
  if outcome_value is null or outcome_value not in ('accepted', 'retry', 'needs_review') then raise exception 'INVALID_EMAIL_OUTCOME'; end if;
  if job.resend_email_id is not null then outcome_value := 'accepted'; end if;
  if outcome_value = 'accepted' and (job.payload is null or nullif(coalesce(job.resend_email_id, email_id_value), '') is null) then raise exception 'EMAIL_REFERENCE_REQUIRED'; end if;
  update public.withdrawal_email_jobs set status = outcome_value,
    resend_email_id = coalesce(resend_email_id, email_id_value),
    accepted_at = case when outcome_value = 'accepted' then coalesce(accepted_at, now()) else accepted_at end,
    lease_token = null, lease_expires_at = null,
    next_attempt_at = now() + make_interval(secs => least(3600, 15 * power(2, least(attempts,8))::integer)),
    last_error = case when outcome_value = 'accepted' then null else left(error_value, 500) end
    where id = job.id returning * into job;
  return job;
end;
$$;

-- The signed webhook can reconcile an accepted email whose HTTP response was lost.
create function public.record_withdrawal_email_delivery(target_job_id uuid, email_id_value text, recipient_value text, status_value text, occurred_at_value timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.withdrawal_email_jobs%rowtype;
begin
  if status_value is null or status_value not in ('sent','delivery_delayed','delivered','failed','bounced','complained','suppressed')
    or nullif(email_id_value, '') is null or occurred_at_value is null then raise exception 'INVALID_EMAIL_EVENT'; end if;
  select * into job from public.withdrawal_email_jobs where id = target_job_id for update;
  if not found or job.payload is null then return false; end if;
  if lower(job.payload #>> '{to,0}') is distinct from lower(recipient_value)
    or (job.resend_email_id is not null and job.resend_email_id <> email_id_value) then raise exception 'EMAIL_EVENT_MISMATCH'; end if;
  update public.withdrawal_email_jobs set status = 'accepted', resend_email_id = email_id_value,
    accepted_at = coalesce(accepted_at, occurred_at_value), last_error = null,
    delivery_status = case when delivery_event_at is null or occurred_at_value >= delivery_event_at then status_value else delivery_status end,
    delivery_event_at = greatest(delivery_event_at, occurred_at_value)
    where id = job.id;
  return true;
end;
$$;
revoke all on function public.submit_store_withdrawal(uuid,uuid,uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.claim_withdrawal_email(text,uuid) from public, anon, authenticated;
revoke all on function public.prepare_withdrawal_email(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.finish_withdrawal_email(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.record_withdrawal_email_delivery(uuid,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.submit_store_withdrawal(uuid,uuid,uuid,text,text,text,text,text,text,text) to service_role;
grant execute on function public.claim_withdrawal_email(text,uuid) to service_role;
grant execute on function public.prepare_withdrawal_email(uuid,uuid,jsonb) to service_role;
grant execute on function public.finish_withdrawal_email(uuid,uuid,text,text,text) to service_role;
grant execute on function public.record_withdrawal_email_delivery(uuid,text,text,text,timestamptz) to service_role;

-- Keep withdrawal available after a merchant closes their shop.
-- A hidden storefront may identify itself without exposing its content.
-- Keep the published-store views, SEO APIs and product RLS unchanged.
create or replace function public.closed_storefront_branding(requested_slug text default null, requested_hostname text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', coalesce(nullif(btrim(s.settings ->> 'editableStoreName'), ''), s.name),
    'logo', s.settings ->> 'storeLogo',
    'theme', s.settings ->> 'storeTheme',
    'accent', s.settings ->> 'storeAccent',
    'withdrawalSlug', s.slug
  )
  from public.stores s
  where not s.is_published
    and s.owner_id is not null
    and lower(s.slug) not in ('test', 'kaubamaja')
    and (
      (requested_hostname is null and s.slug = lower(btrim(requested_slug)))
      or (requested_slug is null and exists (
        select 1 from public.custom_domains d
        where d.store_id = s.id and d.status = 'active'
          and (d.hostname = lower(rtrim(btrim(requested_hostname), '.'))
            or d.redirect_hostname = lower(rtrim(btrim(requested_hostname), '.')))
      ))
    )
  limit 1;
$$;

revoke all on function public.closed_storefront_branding(text, text) from public;
grant execute on function public.closed_storefront_branding(text, text) to anon, authenticated;
comment on function public.closed_storefront_branding(text, text) is
  'Exact lookup of a hidden shop: name, logo, theme, accent and public slug for the withdrawal form. No products, contacts or seller settings.';
