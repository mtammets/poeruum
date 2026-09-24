-- Resend delivery events can belong to other applications on the same account.
-- Unknown historical messages stay unclassified until their sender is verified.
alter table public.email_deliveries
  add column sender_email text,
  add column source_application text
    check (source_application in ('poeruum', 'external'));

comment on column public.email_deliveries.source_application is
  'Verified application ownership; NULL means the message has not been classified.';

create function public.attribute_local_email_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_sender text;
  sender_address text;
begin
  -- A verified external sender must never be reclassified by a status update.
  if new.source_application is not null then return new; end if;

  select job.payload ->> 'from' into order_sender
  from public.order_email_jobs job
  where job.resend_email_id = new.resend_email_id;
  if found then
    new.source_application := 'poeruum';
    sender_address := lower(btrim(coalesce(
      substring(order_sender from '<([^<>[:space:]@]+@[^<>[:space:]@]+)>'),
      order_sender
    )));
    if new.sender_email is null and sender_address ~ '^[^<>[:space:]@]+@[^<>[:space:]@]+$' then
      new.sender_email := sender_address;
    end if;
  elsif exists (
    select 1 from public.sales_leads lead
    where lead.resend_email_id = new.resend_email_id
  ) then
    new.source_application := 'poeruum';
  end if;
  return new;
end;
$$;

revoke all on function public.attribute_local_email_delivery() from public, anon, authenticated;

create trigger email_deliveries_attribute_local_source
before insert or update on public.email_deliveries
for each row execute function public.attribute_local_email_delivery();

-- Use the same provider-ID correlation for historical rows and future SQL
-- writes. Subjects and email_type tags cannot establish application ownership.
update public.email_deliveries delivery
set sender_email = delivery.sender_email
where delivery.source_application is null
  and (
    exists (select 1 from public.order_email_jobs job where job.resend_email_id = delivery.resend_email_id)
    or exists (select 1 from public.sales_leads lead where lead.resend_email_id = delivery.resend_email_id)
  );

create index email_deliveries_poeruum_recipient_idx
on public.email_deliveries(lower(recipient_email), sent_at desc)
where source_application = 'poeruum';

create or replace function public.admin_latest_email_deliveries()
returns table (
  user_id uuid,
  resend_email_id text,
  subject text,
  email_type text,
  status text,
  sent_at timestamptz,
  status_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return query
  select users.id, delivery.resend_email_id, delivery.subject, delivery.email_type,
    delivery.status, delivery.sent_at, delivery.status_updated_at
  from auth.users users
  join lateral (
    select candidate.* from public.email_deliveries candidate
    where lower(candidate.recipient_email) = lower(users.email)
      and candidate.source_application = 'poeruum'
    order by candidate.sent_at desc
    limit 1
  ) delivery on true;
end;
$$;

revoke all on function public.admin_latest_email_deliveries() from public, anon;
grant execute on function public.admin_latest_email_deliveries() to authenticated;
