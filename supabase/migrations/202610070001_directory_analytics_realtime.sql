-- Publish only an admin-only invalidation counter, never raw visitor events.
create table public.admin_directory_refresh (
  id boolean primary key default true check (id),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.admin_directory_refresh enable row level security;
revoke all on public.admin_directory_refresh from public, anon, authenticated;
grant select on public.admin_directory_refresh to authenticated, service_role;
create policy "Admins receive directory refresh signals"
on public.admin_directory_refresh for select to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') = 'admin');
insert into public.admin_directory_refresh (id) values (true);

create function public.signal_admin_directory_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- A duplicate retry or an unrelated page view does not refresh the chart.
  if exists(select from inserted_events where event_name in ('store_impression','store_click','product_click')) then
    update public.admin_directory_refresh set revision=revision+1,updated_at=clock_timestamp() where id=true;
  end if;
  return null;
end;
$$;
revoke all on function public.signal_admin_directory_event() from public,anon,authenticated;
create trigger signal_directory_after_events after insert on public.directory_analytics_events
referencing new table as inserted_events for each statement execute function public.signal_admin_directory_event();

create function public.signal_admin_directory_refresh()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.admin_directory_refresh set revision=revision+1,updated_at=clock_timestamp() where id=true;
  return null;
end;
$$;
revoke all on function public.signal_admin_directory_refresh() from public,anon,authenticated;
create trigger signal_directory_after_stores after insert or update or delete on public.stores
for each statement execute function public.signal_admin_directory_refresh();
create trigger signal_directory_after_settings after update on public.directory_analytics_settings
for each statement execute function public.signal_admin_directory_refresh();

alter publication supabase_realtime add table public.admin_directory_refresh;
