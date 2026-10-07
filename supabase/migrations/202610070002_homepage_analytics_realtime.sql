-- Admin-only invalidation signal. Anonymous visitor rows stay private.
create table public.admin_homepage_refresh (
  id boolean primary key default true check (id),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.admin_homepage_refresh enable row level security;
revoke all on public.admin_homepage_refresh from public, anon, authenticated;
grant select on public.admin_homepage_refresh to authenticated, service_role;
create policy "Admins receive homepage refresh signals"
on public.admin_homepage_refresh for select to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') = 'admin');
insert into public.admin_homepage_refresh (id) values (true);

create function public.signal_admin_homepage_events()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select from changed_events) then
    update public.admin_homepage_refresh set revision=revision+1, updated_at=clock_timestamp() where id;
  end if;
  return null;
end;
$$;
revoke all on function public.signal_admin_homepage_events() from public, anon, authenticated;
create trigger signal_homepage_after_insert after insert on public.homepage_analytics_events
referencing new table as changed_events for each statement execute function public.signal_admin_homepage_events();
create trigger signal_homepage_after_delete after delete on public.homepage_analytics_events
referencing old table as changed_events for each statement execute function public.signal_admin_homepage_events();

create function public.signal_admin_homepage_engagement()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select from updated_events n join previous_events o using (id) where n.engaged_seconds is distinct from o.engaged_seconds) then
    update public.admin_homepage_refresh set revision=revision+1, updated_at=clock_timestamp() where id;
  end if;
  return null;
end;
$$;
revoke all on function public.signal_admin_homepage_engagement() from public, anon, authenticated;
create trigger signal_homepage_after_engagement after update on public.homepage_analytics_events
referencing new table as updated_events old table as previous_events
for each statement execute function public.signal_admin_homepage_engagement();

-- Existing dashboard signals cover new accounts and changes to their stores.
create function public.signal_admin_homepage_cohort()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.admin_homepage_refresh set revision=revision+1, updated_at=clock_timestamp() where id;
  return null;
end;
$$;
revoke all on function public.signal_admin_homepage_cohort() from public, anon, authenticated;
create trigger signal_homepage_after_cohort after update on public.admin_dashboard_refresh
for each statement execute function public.signal_admin_homepage_cohort();

alter publication supabase_realtime add table public.admin_homepage_refresh;
