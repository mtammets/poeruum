\set ON_ERROR_STOP on
begin;
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('c7310000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'story-test@example.invalid', '{}', '{}', now(), now()),
('c7310000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'story-admin@example.invalid', '{"role":"admin"}', '{}', now(), now());
insert into public.stores (id, owner_id, name, slug) values
('c7310000-0000-4000-8000-000000000002', 'c7310000-0000-4000-8000-000000000001', 'Loo testpood', 'story-interview-test');
insert into public.story_interviews (id, store_id, token_hash, messages) values
('c7310000-0000-4000-8000-000000000003', 'c7310000-0000-4000-8000-000000000002', repeat('a',64), '[{"role":"assistant","content":"Kuidas alustasid?"}]');

set local role anon;
do $$ begin
  begin perform id from public.story_interviews; raise exception 'Anonymous transcript access'; exception when insufficient_privilege then null; end;
  begin perform public.claim_story_interview('c7310000-0000-4000-8000-000000000003', repeat('a',64), 0, gen_random_uuid()); raise exception 'Anonymous claim'; exception when insufficient_privilege then null; end;
  begin perform public.publish_story_interview('c7310000-0000-4000-8000-000000000003', repeat('a',64), gen_random_uuid(), 'test', '{}'); raise exception 'Anonymous publish'; exception when undefined_function then null; end;
  begin perform public.approve_story_interview('c7310000-0000-4000-8000-000000000003', 0, 'c7310000-0000-4000-8000-000000000009', 'test', '{}'); raise exception 'Anonymous approval'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform id from public.story_interviews; raise exception 'Merchant transcript access'; exception when insufficient_privilege then null; end;
  begin update public.directory_stories set is_published = true; raise exception 'Merchant publication write'; exception when insufficient_privilege then null; end;
  begin perform public.approve_story_interview('c7310000-0000-4000-8000-000000000003', 0, 'c7310000-0000-4000-8000-000000000009', 'test', '{}'); raise exception 'Merchant impersonates admin'; exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
do $$ declare row public.story_interviews; begin
  begin perform public.claim_story_interview('c7310000-0000-4000-8000-000000000003', repeat('b',64), 0, gen_random_uuid()); raise exception 'Wrong token accepted'; exception when insufficient_privilege then null; end;
  row := public.claim_story_interview('c7310000-0000-4000-8000-000000000003', repeat('a',64), 0, 'c7310000-0000-4000-8000-000000000004');
  if row.operation_id is null then raise exception 'Lease missing'; end if;
  begin perform public.claim_story_interview(row.id, repeat('a',64), 0, gen_random_uuid()); raise exception 'Concurrent request accepted'; exception when serialization_failure then null; end;
  begin perform public.publish_story_interview(row.id, repeat('a',64), row.operation_id, 'test', '{}'); raise exception 'Legacy publication allowed'; exception when undefined_function then null; end;
  update public.story_interviews set busy_until = now() - interval '1 second', version = 1 where id = row.id;
  begin perform public.claim_story_interview(row.id, repeat('a',64), 0, gen_random_uuid()); raise exception 'Stale version accepted'; exception when serialization_failure then null; end;
  row := public.claim_story_interview(row.id, repeat('a',64), 1, 'c7310000-0000-4000-8000-000000000005');
  update public.story_interviews set status = 'preview', draft = '{"title":"Lugu"}', image_path = 'private/photo.webp', body_image_path = 'private/detail.webp' where id = row.id;
  begin perform public.approve_story_interview(row.id, 1, 'c7310000-0000-4000-8000-000000000009', 'test', '{}'); raise exception 'Unsubmitted preview approved'; exception when serialization_failure then null; end;
  update public.story_interviews set status = 'pending_review', version = 2, last_request_id = operation_id,
    operation_id = null, busy_until = null where id = row.id;
  begin perform public.claim_story_interview(row.id, repeat('a',64), 2, gen_random_uuid()); raise exception 'Submitted interview remains editable'; exception when serialization_failure then null; end;
  begin perform public.publish_story_interview(row.id, repeat('a',64), row.operation_id, 'test', '{}'); raise exception 'Legacy approval bypass'; exception when undefined_function then null; end;
  begin perform public.approve_story_interview(row.id, 2, 'c7310000-0000-4000-8000-000000000001', 'test', '{}'); raise exception 'Non-admin reviewer'; exception when insufficient_privilege then null; end;
  begin perform public.approve_story_interview(row.id, 1, 'c7310000-0000-4000-8000-000000000009', 'test', '{}'); raise exception 'Stale approval accepted'; exception when serialization_failure then null; end;
  update public.story_interviews set status = 'revoked' where id = row.id;
  begin perform public.approve_story_interview(row.id, 2, 'c7310000-0000-4000-8000-000000000009', 'test', '{}'); raise exception 'Revoked submission approved'; exception when serialization_failure then null; end;
  update public.story_interviews set status = 'pending_review', expires_at = now() - interval '60 days' where id = row.id;
  perform public.apply_story_interview_retention();
  if not exists(select from public.story_interviews where id = row.id and draft is not null) then raise exception 'Pending review lost after link expiry'; end if;
  if exists(select from public.directory_stories where interview_id = row.id) then raise exception 'Submission created an article before approval'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  if exists(select id from public.directory_stories where id = 'c7310000-0000-4000-8000-000000000003') then raise exception 'Pending story exposed'; end if;
end $$;
reset role;
set local role service_role;
do $$ declare article public.directory_stories; begin
  article := public.approve_story_interview('c7310000-0000-4000-8000-000000000003', 2, 'c7310000-0000-4000-8000-000000000009', 'test-merchant-story', '{"title":"Lugu"}');
  perform public.approve_story_interview(article.id, 2, 'c7310000-0000-4000-8000-000000000009', 'test-merchant-story', '{"title":"Overwrite"}');
  if (select count(*) from public.directory_stories where interview_id = article.id) <> 1 then raise exception 'Duplicate article'; end if;
  if (select story->>'title' from public.directory_stories where id = article.id) <> 'Lugu' then raise exception 'Retry overwrote article'; end if;
  if (select status from public.story_interviews where id = article.id) <> 'published' then raise exception 'Publication not atomic'; end if;
  if (select approved_by from public.story_interviews where id = article.id) is distinct from 'c7310000-0000-4000-8000-000000000009'::uuid then raise exception 'Reviewer not recorded'; end if;
  if article.body_image_path is distinct from 'private/detail.webp' then raise exception 'Second photo not published atomically'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  if not exists(select id from public.directory_stories where slug = 'test-merchant-story') then raise exception 'Published story invisible'; end if;
  begin perform image_path from public.directory_stories; raise exception 'Private photo path exposed'; exception when insufficient_privilege then null; end;
  begin perform body_image_path from public.directory_stories; raise exception 'Private second photo path exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.directory_stories set is_published = false where slug = 'test-merchant-story';
update public.story_interviews set expires_at = now() - interval '1 second' where id = 'c7310000-0000-4000-8000-000000000003';
set local role service_role;
do $$ begin
  begin perform public.claim_story_interview('c7310000-0000-4000-8000-000000000003', repeat('a',64), 2, gen_random_uuid()); raise exception 'Expired invitation accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  if exists(select id from public.directory_stories where slug = 'test-merchant-story') then raise exception 'Hidden story exposed'; end if;
end $$;
reset role;
-- Retention keeps the approved public article but removes its source transcript.
update public.story_interviews set status = 'published', updated_at = now() - interval '31 days'
  where id = 'c7310000-0000-4000-8000-000000000003';
select public.apply_story_interview_retention();
do $$ begin
  if exists(select from public.story_interviews where id = 'c7310000-0000-4000-8000-000000000003' and (messages <> '[]'::jsonb or draft is not null))
    then raise exception 'Published transcript retained'; end if;
  if not exists(select from public.directory_stories where slug = 'test-merchant-story') then raise exception 'Retention removed article'; end if;
end $$;
-- Removing an owner also removes stories from an accounting tombstone store.
update public.stores set owner_id = null where id = 'c7310000-0000-4000-8000-000000000002';
do $$ begin
  if exists(select from public.story_interviews where id = 'c7310000-0000-4000-8000-000000000003')
    or exists(select from public.directory_stories where slug = 'test-merchant-story') then raise exception 'Deleted merchant story retained'; end if;
  if not exists(select from public.external_resource_cleanup where provider = 'supabase_storage' and resource_type = 'story_image_prefix'
    and resource_id = 'c7310000-0000-4000-8000-000000000003') then raise exception 'Photo cleanup not queued'; end if;
end $$;
rollback;
