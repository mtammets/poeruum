-- Keep both draft photos private, and snapshot their paths together on publication.
alter table public.story_interviews
  add column body_image_path text,
  add column body_image_alt text not null default '' check (length(body_image_alt) <= 300),
  add column body_image_caption text not null default '' check (length(body_image_caption) <= 300);

alter table public.directory_stories add column body_image_path text;

create or replace function public.publish_story_interview(target_id uuid, access_hash text, request_id uuid, article_slug text, article_document jsonb)
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
  insert into public.directory_stories (id, interview_id, store_id, slug, story, image_path, body_image_path)
    values (target_id, target_id, current_row.store_id, article_slug, article_document, current_row.image_path, current_row.body_image_path)
    returning * into article;
  update public.story_interviews set status = 'published', version = version + 1, last_request_id = request_id,
    operation_id = null, busy_until = null, updated_at = now() where id = target_id;
  return article;
end;
$$;
