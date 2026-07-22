create table public.user_presence_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

create index user_presence_sessions_last_seen_at_idx
on public.user_presence_sessions(last_seen_at);

alter table public.user_presence_sessions enable row level security;
revoke all on table public.user_presence_sessions from public, anon, authenticated;
grant select on table public.user_presence_sessions to authenticated;

create policy "Admins read online presence"
on public.user_presence_sessions for select to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin');

create or replace function public.touch_user_presence(target_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  insert into public.user_presence_sessions (session_id, user_id, last_seen_at)
  values (target_session_id, current_user_id, now())
  on conflict (session_id) do update
  set last_seen_at = excluded.last_seen_at
  where public.user_presence_sessions.user_id = excluded.user_id;

  delete from public.user_presence_sessions
  where last_seen_at < now() - interval '1 day';
end;
$$;

create or replace function public.leave_user_presence(target_session_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.user_presence_sessions
  where session_id = target_session_id
    and user_id = (select auth.uid());
$$;

create or replace function public.admin_online_users()
returns table (user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select distinct presence.user_id
  from public.user_presence_sessions as presence
  where presence.last_seen_at >= now() - interval '95 seconds';
end;
$$;

revoke all on function public.touch_user_presence(uuid) from public, anon;
revoke all on function public.leave_user_presence(uuid) from public, anon;
revoke all on function public.admin_online_users() from public, anon;
grant execute on function public.touch_user_presence(uuid) to authenticated;
grant execute on function public.leave_user_presence(uuid) to authenticated;
grant execute on function public.admin_online_users() to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_presence_sessions'
  ) then
    alter publication supabase_realtime add table public.user_presence_sessions;
  end if;
end $$;
