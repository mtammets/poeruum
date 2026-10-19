-- Submission stays private until an administrator approves the reviewed version.
alter table public.story_interviews drop constraint story_interviews_status_check;
alter table public.story_interviews add constraint story_interviews_status_check
  check (status in ('interview', 'photo', 'preview', 'pending_review', 'published', 'revoked'));
alter table public.story_interviews add column approved_by uuid references auth.users(id) on delete set null;

create or replace function public.claim_story_interview(target_id uuid, access_hash text, expected_version integer, request_id uuid)
returns public.story_interviews language plpgsql security definer set search_path = public as $$
declare current_row public.story_interviews;
begin
  select * into current_row from public.story_interviews where id = target_id for update;
  if not found or current_row.token_hash <> access_hash or current_row.expires_at <= now() or current_row.status = 'revoked' then
    raise exception 'Interview unavailable' using errcode = '42501';
  end if;
  if current_row.last_request_id = request_id then return current_row; end if;
  if current_row.status in ('pending_review', 'published')
    or current_row.version <> expected_version or current_row.busy_until > now() then
    raise exception 'Interview changed or busy' using errcode = '40001';
  end if;
  update public.story_interviews set operation_id = request_id, busy_until = now() + interval '120 seconds'
    where id = target_id returning * into current_row;
  return current_row;
end;
$$;

-- Remove the old invitation-based publication path, including during rollout.
drop function public.publish_story_interview(uuid, text, uuid, text, jsonb);

create function public.approve_story_interview(target_id uuid, expected_version integer, reviewer_id uuid, article_slug text, article_document jsonb)
returns public.directory_stories language plpgsql security definer set search_path = public as $$
declare current_row public.story_interviews; article public.directory_stories;
begin
  if not exists(select 1 from auth.users where id = reviewer_id and raw_app_meta_data->>'role' = 'admin') then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  select * into current_row from public.story_interviews where id = target_id for update;
  if not found then raise exception 'Interview unavailable' using errcode = '42501'; end if;
  select * into article from public.directory_stories where interview_id = target_id;
  if found and current_row.status = 'published' then return article; end if;
  if current_row.status <> 'pending_review' or current_row.version is distinct from expected_version
    or current_row.draft is null or current_row.image_path is null then
    raise exception 'Interview not ready or changed' using errcode = '40001';
  end if;
  insert into public.directory_stories (id, interview_id, store_id, slug, story, image_path, body_image_path)
    values (target_id, target_id, current_row.store_id, article_slug, article_document, current_row.image_path, current_row.body_image_path)
    returning * into article;
  update public.story_interviews set status = 'published', approved_by = reviewer_id, version = version + 1,
    operation_id = null, busy_until = null, updated_at = now() where id = target_id;
  return article;
end;
$$;
revoke all on function public.approve_story_interview(uuid, integer, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.approve_story_interview(uuid, integer, uuid, text, jsonb) to service_role;

-- Expiring the merchant's link must not delete an administrator's review queue.
create or replace function public.apply_story_interview_retention() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.story_interviews where status not in ('pending_review', 'published')
    and (expires_at < now() - interval '30 days' or (status = 'revoked' and updated_at < now() - interval '30 days'));
  update public.story_interviews set messages = '[]'::jsonb, draft = null
    where status = 'published' and updated_at < now() - interval '30 days' and (messages <> '[]'::jsonb or draft is not null);
end;
$$;
