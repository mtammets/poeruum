create table if not exists public.platform_settings (
  id text primary key check (id = 'homepage'),
  coming_soon_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.platform_settings (id, coming_soon_enabled)
values ('homepage', true)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

revoke insert, update, delete on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to anon, authenticated;

create policy "Homepage mode is publicly readable"
on public.platform_settings
for select
to anon, authenticated
using (id = 'homepage');

create or replace function public.admin_set_coming_soon(next_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  update public.platform_settings
  set coming_soon_enabled = next_enabled,
      updated_at = now(),
      updated_by = auth.uid()
  where id = 'homepage';

  return next_enabled;
end;
$$;

revoke all on function public.admin_set_coming_soon(boolean) from public, anon;
grant execute on function public.admin_set_coming_soon(boolean) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'platform_settings'
  ) then
    alter publication supabase_realtime add table public.platform_settings;
  end if;
end
$$;
