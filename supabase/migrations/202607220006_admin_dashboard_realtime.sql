create table public.admin_dashboard_refresh (
  id boolean primary key default true check (id),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.admin_dashboard_refresh enable row level security;
revoke all on table public.admin_dashboard_refresh from public, anon, authenticated;
grant select on table public.admin_dashboard_refresh to authenticated;

create policy "Admins receive dashboard refresh signals"
on public.admin_dashboard_refresh for select to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin');

insert into public.admin_dashboard_refresh (id)
values (true)
on conflict (id) do nothing;

create or replace function public.signal_admin_dashboard_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.admin_dashboard_refresh
  set revision = revision + 1,
      updated_at = now()
  where id = true;
  return null;
end;
$$;

revoke all on function public.signal_admin_dashboard_refresh() from public, anon, authenticated;

create trigger signal_admin_dashboard_after_users
after insert or update or delete on auth.users
for each statement execute function public.signal_admin_dashboard_refresh();

create trigger signal_admin_dashboard_after_stores
after insert or update or delete on public.stores
for each statement execute function public.signal_admin_dashboard_refresh();

create trigger signal_admin_dashboard_after_products
after insert or update or delete on public.products
for each statement execute function public.signal_admin_dashboard_refresh();

create trigger signal_admin_dashboard_after_orders
after insert or update or delete on public.orders
for each statement execute function public.signal_admin_dashboard_refresh();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'admin_dashboard_refresh'
  ) then
    alter publication supabase_realtime add table public.admin_dashboard_refresh;
  end if;
end $$;
