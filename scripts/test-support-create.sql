-- Rolled-back fixtures: safe to run against the local migration test database.
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('79000000-0000-4000-8000-000000000001','authenticated','authenticated','support-admin@example.invalid','{"role":"admin"}','{}',now(),now()),
('79000000-0000-4000-8000-000000000002','authenticated','authenticated','support-user@example.invalid','{}','{}',now(),now()),
('79000000-0000-4000-8000-000000000003','authenticated','authenticated','support-other@example.invalid','{}','{}',now(),now());
insert into public.stores(id,owner_id,name,slug,settings) values
('79000000-0000-4000-8000-000000000004','79000000-0000-4000-8000-000000000002','Support fixture','support-create-fixture','{}');

do $$
declare
  result jsonb;
  original_payload jsonb := '{"from":"support@example.invalid","to":["support-user@example.invalid"],"subject":"Abi seadistamisel","text":"Tere! Kas saan aidata?"}';
begin
  if has_function_privilege('authenticated', 'public.prepare_admin_support_message(uuid,uuid,uuid,text,text,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.prepare_admin_support_message(uuid,uuid,uuid,text,text,jsonb)', 'execute')
    or has_table_privilege('authenticated', 'public.support_outbound_requests', 'select') then
    raise exception 'Private outbound sending is accessible to app users';
  end if;
  if not has_function_privilege('service_role', 'public.prepare_admin_support_message(uuid,uuid,uuid,text,text,jsonb)', 'execute') then
    raise exception 'Edge service cannot prepare messages';
  end if;
  begin
    perform public.prepare_admin_support_message('79000000-0000-4000-8000-000000000005',
      '79000000-0000-4000-8000-000000000002', '79000000-0000-4000-8000-000000000003',
      'Abi seadistamisel', 'Tere! Kas saan aidata?', original_payload);
    raise exception 'Merchant was able to start an admin conversation';
  exception when insufficient_privilege then null; end;

  result := public.prepare_admin_support_message('79000000-0000-4000-8000-000000000005',
    '79000000-0000-4000-8000-000000000002', '79000000-0000-4000-8000-000000000001',
    'Abi seadistamisel', 'Tere! Kas saan aidata?', original_payload);
  if result ->> 'conversation_id' <> '79000000-0000-4000-8000-000000000005'
    or result -> 'payload' <> original_payload then raise exception 'Incorrect prepared message'; end if;
  if not exists (select 1 from public.support_conversations where id = (result ->> 'conversation_id')::uuid
    and user_id = '79000000-0000-4000-8000-000000000002' and store_id = '79000000-0000-4000-8000-000000000004'
    and origin = 'app' and status = 'waiting_user' and admin_read_at is not null and user_read_at is null) then
    raise exception 'Conversation ownership, unread state or waiting status is incorrect';
  end if;
  -- A changed sender configuration cannot change the already prepared payload.
  result := public.prepare_admin_support_message('79000000-0000-4000-8000-000000000005',
    '79000000-0000-4000-8000-000000000002', '79000000-0000-4000-8000-000000000001',
    'Abi seadistamisel', 'Tere! Kas saan aidata?', original_payload || '{"from":"changed@example.invalid"}'::jsonb);
  if result -> 'payload' <> original_payload or (select count(*) from public.support_messages
    where conversation_id = '79000000-0000-4000-8000-000000000005') <> 1 then raise exception 'Retry changed or duplicated the message'; end if;
  begin
    perform public.prepare_admin_support_message('79000000-0000-4000-8000-000000000005',
      '79000000-0000-4000-8000-000000000003', '79000000-0000-4000-8000-000000000001',
      'Abi seadistamisel', 'Tere! Kas saan aidata?', original_payload);
    raise exception 'Request was reassigned to another user';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.prepare_admin_support_message('79000000-0000-4000-8000-000000000005',
      '79000000-0000-4000-8000-000000000002', '79000000-0000-4000-8000-000000000001',
      'Abi seadistamisel', 'Different body', original_payload);
    raise exception 'Request was reused with different content';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.prepare_admin_support_message('79000000-0000-4000-8000-000000000006',
      '79000000-0000-4000-8000-000000000002', '79000000-0000-4000-8000-000000000001',
      'Invalid message', '', original_payload);
    raise exception 'Invalid message accepted';
  exception when check_violation then null; end;
  if exists (select 1 from public.support_conversations where id = '79000000-0000-4000-8000-000000000006') then
    raise exception 'Message failure left an empty conversation';
  end if;
  -- An account without a store can also receive a support conversation.
  perform public.prepare_admin_support_message('79000000-0000-4000-8000-000000000007',
    '79000000-0000-4000-8000-000000000003', '79000000-0000-4000-8000-000000000001',
    'Tere tulemast', 'Kas saan aidata?', original_payload);
  if not exists (select 1 from public.support_conversations where id = '79000000-0000-4000-8000-000000000007'
    and store_id is null) then raise exception 'Storeless account could not be contacted'; end if;
  delete from public.support_conversations where id = '79000000-0000-4000-8000-000000000005';
  if exists (select 1 from public.support_outbound_requests where message_id = '79000000-0000-4000-8000-000000000005') then
    raise exception 'Deleting a conversation left a private email payload';
  end if;
end;
$$;
rollback;
