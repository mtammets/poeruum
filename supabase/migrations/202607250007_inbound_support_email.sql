alter table public.support_conversations
  alter column user_id drop not null,
  add column origin text not null default 'app'
    check (origin in ('app', 'email')),
  add column external_email text,
  add column external_name text;

alter table public.support_conversations
  add constraint support_conversations_contact_check check (
    (origin = 'app' and user_id is not null and external_email is null)
    or
    (
      origin = 'email'
      and user_id is null
      and external_email is not null
      and external_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

create index support_conversations_external_email_idx
  on public.support_conversations(lower(external_email), created_at desc)
  where origin = 'email';

drop function if exists public.admin_support_conversations();
create function public.admin_support_conversations()
returns table (
  id uuid,
  user_id uuid,
  email text,
  contact_name text,
  origin text,
  store_id uuid,
  store_name text,
  pricing_plan text,
  subject text,
  category text,
  status text,
  last_message_at timestamptz,
  last_message_preview text,
  is_unread boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return query
  select conversation.id, conversation.user_id,
    coalesce(users.email::text, conversation.external_email),
    conversation.external_name, conversation.origin,
    conversation.store_id, store.name, store.pricing_plan,
    conversation.subject, conversation.category, conversation.status,
    conversation.last_message_at, conversation.last_message_preview,
    conversation.admin_read_at is null, conversation.created_at
  from public.support_conversations conversation
  left join auth.users users on users.id = conversation.user_id
  left join public.stores store on store.id = conversation.store_id
  order by (conversation.status = 'resolved'), conversation.last_message_at desc;
end;
$$;

revoke all on function public.admin_support_conversations() from public, anon;
grant execute on function public.admin_support_conversations() to authenticated;

comment on column public.support_conversations.origin is
  'Whether the conversation was opened by an authenticated app user or by an external email to the public support address.';
comment on column public.support_conversations.external_email is
  'Reply address for a conversation received from a person without a Poeruum account.';
comment on column public.support_conversations.external_name is
  'Untrusted display name parsed from the From header of an inbound email.';

