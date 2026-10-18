-- Bearer invitation secrets are hashed; drafts and transcripts are service-only.
create table public.story_interviews (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null default now() + interval '30 days',
  status text not null default 'interview' check (status in ('interview', 'photo', 'preview', 'published', 'revoked')),
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array' and octet_length(messages::text) <= 100000),
  draft jsonb check (draft is null or (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 50000)),
  image_path text,
  image_alt text not null default '' check (length(image_alt) <= 300),
  version integer not null default 0,
  operation_id uuid,
  busy_until timestamptz,
  last_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index story_interviews_store on public.story_interviews(store_id, created_at desc);
alter table public.story_interviews enable row level security;
revoke all on public.story_interviews from public, anon, authenticated;
grant all on public.story_interviews to service_role;

create table public.directory_stories (
  id uuid primary key,
  interview_id uuid not null unique references public.story_interviews(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  story jsonb not null check (jsonb_typeof(story) = 'object' and octet_length(story::text) <= 60000),
  image_path text not null,
  is_published boolean not null default true,
  published_at timestamptz not null default now()
);
create index directory_stories_latest on public.directory_stories(published_at desc) where is_published;
create index directory_stories_store on public.directory_stories(store_id);
alter table public.directory_stories enable row level security;
revoke all on public.directory_stories from public, anon, authenticated;
grant select (id, slug, story, store_id, published_at, is_published) on public.directory_stories to anon, authenticated;
grant all on public.directory_stories to service_role;
create policy "Published merchant stories" on public.directory_stories for select to anon, authenticated using (is_published);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('story-interviews', 'story-interviews', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
-- Deliberately no client Storage policies. Uploads and signed draft URLs use the
-- verified invitation; public images are served only for published stories.

create function public.claim_story_interview(target_id uuid, access_hash text, expected_version integer, request_id uuid)
returns public.story_interviews language plpgsql security definer set search_path = public as $$
declare current_row public.story_interviews;
begin
  select * into current_row from public.story_interviews where id = target_id for update;
  if not found or current_row.token_hash <> access_hash or current_row.expires_at <= now() or current_row.status = 'revoked' then
    raise exception 'Interview unavailable' using errcode = '42501';
  end if;
  if current_row.last_request_id = request_id then return current_row; end if;
  if current_row.version <> expected_version or current_row.busy_until > now() then
    raise exception 'Interview changed or busy' using errcode = '40001';
  end if;
  update public.story_interviews set operation_id = request_id, busy_until = now() + interval '120 seconds'
    where id = target_id returning * into current_row;
  return current_row;
end;
$$;

create function public.publish_story_interview(target_id uuid, access_hash text, request_id uuid, article_slug text, article_document jsonb)
returns public.directory_stories language plpgsql security definer set search_path = public as $$
declare current_row public.story_interviews; article public.directory_stories;
begin
  select * into current_row from public.story_interviews where id = target_id for update;
  if not found or current_row.token_hash <> access_hash or current_row.expires_at <= now() or current_row.status = 'revoked' then
    raise exception 'Interview unavailable' using errcode = '42501';
  end if;
  select * into article from public.directory_stories where interview_id = target_id;
  if found then return article; end if;
  if current_row.status <> 'preview' or current_row.draft is null or current_row.image_path is null
    or current_row.operation_id is distinct from request_id then
    raise exception 'Interview not ready' using errcode = '40001';
  end if;
  insert into public.directory_stories (id, interview_id, store_id, slug, story, image_path)
    values (target_id, target_id, current_row.store_id, article_slug, article_document, current_row.image_path)
    returning * into article;
  update public.story_interviews set status = 'published', version = version + 1, last_request_id = request_id,
    operation_id = null, busy_until = null, updated_at = now() where id = target_id;
  return article;
end;
$$;

revoke all on function public.claim_story_interview(uuid, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.publish_story_interview(uuid, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_story_interview(uuid, text, integer, uuid) to service_role;
grant execute on function public.publish_story_interview(uuid, text, uuid, text, jsonb) to service_role;

alter table public.external_resource_cleanup drop constraint external_resource_cleanup_resource_pair_check;
alter table public.external_resource_cleanup add constraint external_resource_cleanup_resource_pair_check check (
  (provider = 'stripe' and resource_type in ('connected_account', 'customer'))
  or (provider = 'supabase_storage' and resource_type in ('product_image_prefix', 'story_image_prefix'))
);
create function public.queue_story_image_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.external_resource_cleanup(provider, resource_type, resource_id)
    values ('supabase_storage', 'story_image_prefix', old.id::text) on conflict do nothing;
  return old;
end;
$$;
create trigger story_interview_image_cleanup after delete on public.story_interviews
for each row execute function public.queue_story_image_cleanup();

create function public.remove_deleted_merchant_stories() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.story_interviews where store_id = new.id;
  return new;
end;
$$;
create trigger remove_deleted_merchant_stories after update of owner_id on public.stores
for each row when (old.owner_id is not null and new.owner_id is null)
execute function public.remove_deleted_merchant_stories();

create function public.apply_story_interview_retention() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.story_interviews where status <> 'published'
    and (expires_at < now() - interval '30 days' or (status = 'revoked' and updated_at < now() - interval '30 days'));
  update public.story_interviews set messages = '[]'::jsonb, draft = null
    where status = 'published' and updated_at < now() - interval '30 days' and (messages <> '[]'::jsonb or draft is not null);
end;
$$;
revoke all on function public.queue_story_image_cleanup() from public, anon, authenticated;
revoke all on function public.remove_deleted_merchant_stories() from public, anon, authenticated;
revoke all on function public.apply_story_interview_retention() from public, anon, authenticated;
grant execute on function public.apply_story_interview_retention() to service_role;
