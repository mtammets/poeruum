create table public.email_deliveries (
  resend_email_id text primary key,
  recipient_email text not null,
  subject text not null default '',
  email_type text,
  status text not null check (status in ('sent', 'delivered', 'failed', 'bounced', 'complained')),
  sent_at timestamptz not null,
  status_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_deliveries_recipient_idx on public.email_deliveries(lower(recipient_email), sent_at desc);
create trigger email_deliveries_updated_at before update on public.email_deliveries
for each row execute function public.set_updated_at();

alter table public.email_deliveries enable row level security;
revoke all on table public.email_deliveries from public, anon, authenticated;
grant select on table public.email_deliveries to authenticated;

create policy "Admins read email delivery history"
on public.email_deliveries for select to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin');

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
    order by candidate.sent_at desc
    limit 1
  ) delivery on true;
end;
$$;

revoke all on function public.admin_latest_email_deliveries() from public, anon;
grant execute on function public.admin_latest_email_deliveries() to authenticated;
