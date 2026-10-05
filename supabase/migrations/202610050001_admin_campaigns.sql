-- Immutable, private snapshots: opening an earlier version never overwrites it.
create table public.admin_campaign_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_id uuid not null,
  name text not null check (length(name) between 1 and 100),
  template text not null check (template in ('phone', 'products', 'message')),
  document jsonb not null check (
    coalesce(jsonb_typeof(document) = 'object' and document->>'version' = '1'
      and jsonb_typeof(document->'copy') = 'object'
      and jsonb_typeof(document->'media') = 'array'
      and jsonb_array_length(document->'media') = 3
      and octet_length(document::text) <= 4000000, false)
  ),
  created_at timestamptz not null default now()
);
create index admin_campaign_versions_history on public.admin_campaign_versions(user_id, created_at desc);
alter table public.admin_campaign_versions enable row level security;
revoke all on public.admin_campaign_versions from public, anon, authenticated;
grant select, insert on public.admin_campaign_versions to authenticated;
create policy "Admins read own campaigns" on public.admin_campaign_versions for select to authenticated
  using ((select public.is_admin()) and user_id = (select auth.uid()));
create policy "Admins create own campaign versions" on public.admin_campaign_versions for insert to authenticated
  with check ((select public.is_admin()) and user_id = (select auth.uid()));
