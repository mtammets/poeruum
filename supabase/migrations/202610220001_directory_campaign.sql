create table public.directory_campaign_settings (
  id text primary key check (id = 'black-friday'),
  mode text not null default 'off' check (mode in ('off', 'on', 'scheduled')),
  starts_at timestamptz,
  ends_at timestamptz,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint directory_campaign_interval check (
    (starts_at is null or isfinite(starts_at)) and (ends_at is null or isfinite(ends_at))
    and (mode <> 'scheduled' or (starts_at is not null and ends_at is not null and ends_at > starts_at))
  )
);
insert into public.directory_campaign_settings (id) values ('black-friday');
alter table public.directory_campaign_settings enable row level security;
revoke all on public.directory_campaign_settings from public, anon, authenticated;

-- Public readers receive only campaign configuration and a trusted clock, not audit data.
create function public.get_directory_campaign()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('mode', mode, 'startsAt', starts_at, 'endsAt', ends_at,
    'revision', revision, 'serverNow', statement_timestamp())
  from public.directory_campaign_settings where id = 'black-friday';
$$;
revoke all on function public.get_directory_campaign() from public;
grant execute on function public.get_directory_campaign() to anon, authenticated;

create function public.admin_set_directory_campaign(
  next_mode text, next_starts_at timestamptz, next_ends_at timestamptz, expected_revision integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if next_mode is null or next_mode not in ('off', 'on', 'scheduled')
    or (next_starts_at is not null and not isfinite(next_starts_at))
    or (next_ends_at is not null and not isfinite(next_ends_at))
    or (next_mode = 'scheduled' and (next_starts_at is null or next_ends_at is null or next_ends_at <= next_starts_at)) then
    raise exception 'Invalid campaign schedule' using errcode = '22023';
  end if;
  update public.directory_campaign_settings
  set mode = next_mode, starts_at = next_starts_at, ends_at = next_ends_at,
      revision = revision + 1, updated_at = clock_timestamp(), updated_by = auth.uid()
  where id = 'black-friday' and revision = expected_revision;
  if not found then
    raise exception 'Campaign changed; reload before saving' using errcode = '40001';
  end if;
  return public.get_directory_campaign();
end;
$$;
revoke all on function public.admin_set_directory_campaign(text, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.admin_set_directory_campaign(text, timestamptz, timestamptz, integer) to authenticated;
