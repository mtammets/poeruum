-- Keep the first message and its exact email payload before contacting Resend.
-- A retried request reuses both the conversation and the provider idempotency key.
create table public.support_outbound_requests (
  message_id uuid primary key references public.support_messages(id) on delete cascade,
  payload jsonb not null
);
alter table public.support_outbound_requests enable row level security;
revoke all on public.support_outbound_requests from public, anon, authenticated;
grant all on public.support_outbound_requests to service_role;

create function public.prepare_admin_support_message(
  request_id uuid, target_user_id uuid, sender_id uuid,
  message_subject text, message_body text, email_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing record;
  selected_store uuid;
begin
  if not exists (select 1 from auth.users where id = sender_id and raw_app_meta_data ->> 'role' = 'admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(request_id::text, 0));
  select m.*, c.user_id, c.subject, r.payload into existing
  from public.support_outbound_requests r
  join public.support_messages m on m.id = r.message_id
  join public.support_conversations c on c.id = m.conversation_id
  where r.message_id = request_id;
  if found then
    if existing.sender_user_id is distinct from sender_id
      or existing.user_id is distinct from target_user_id
      or existing.subject is distinct from message_subject
      or existing.body is distinct from message_body
      or existing.payload -> 'to' is distinct from email_payload -> 'to' then
      raise exception 'Request already belongs to another message' using errcode = '22023';
    end if;
    return jsonb_build_object('id', existing.id, 'conversation_id', existing.conversation_id,
      'payload', existing.payload, 'resend_email_id', existing.resend_email_id,
      'created_at', existing.created_at, 'delivery_updated_at', existing.delivery_updated_at);
  end if;

  select id into selected_store from public.stores where owner_id = target_user_id order by created_at limit 1;
  insert into public.support_conversations(id, user_id, store_id, subject, admin_read_at)
  values (request_id, target_user_id, selected_store, message_subject, now());
  insert into public.support_messages(id, conversation_id, sender_kind, sender_user_id, body)
  values (request_id, request_id, 'admin', sender_id, message_body);
  insert into public.support_outbound_requests(message_id, payload) values (request_id, email_payload);
  return jsonb_build_object('id', request_id, 'conversation_id', request_id,
    'payload', email_payload, 'resend_email_id', null, 'created_at', now());
end;
$$;

revoke all on function public.prepare_admin_support_message(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.prepare_admin_support_message(uuid, uuid, uuid, text, text, jsonb) to service_role;
