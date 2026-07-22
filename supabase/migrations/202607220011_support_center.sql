create table public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  subject text not null check (char_length(subject) between 2 and 160),
  category text not null default 'question' check (category in ('question', 'setup', 'payments', 'orders', 'technical', 'feedback')),
  status text not null default 'open' check (status in ('open', 'waiting_user', 'resolved')),
  page_url text,
  user_agent text,
  last_message_at timestamptz not null default now(),
  last_message_preview text not null default '',
  admin_read_at timestamptz,
  user_read_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index support_conversations_user_idx on public.support_conversations(user_id, last_message_at desc);
create index support_conversations_admin_idx on public.support_conversations(status, last_message_at desc);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_kind text not null check (sender_kind in ('user', 'admin', 'system')),
  sender_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 10000),
  source text not null default 'app' check (source in ('app', 'email')),
  is_internal boolean not null default false,
  attachment_path text,
  attachment_name text,
  resend_email_id text unique,
  inbound_message_id text unique,
  delivery_status text check (delivery_status in ('sent', 'delivered', 'failed', 'bounced', 'complained')),
  delivery_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create index support_messages_conversation_idx on public.support_messages(conversation_id, created_at);

create table public.resend_webhook_events (
  id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.resend_webhook_events enable row level security;
revoke all on table public.resend_webhook_events from public, anon, authenticated;

create trigger support_conversations_updated_at
before update on public.support_conversations
for each row execute function public.set_updated_at();

create or replace function public.sync_support_conversation_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.support_conversations
  set last_message_at = new.created_at,
      last_message_preview = left(regexp_replace(new.body, '\s+', ' ', 'g'), 180),
      status = case
        when new.is_internal then status
        when new.sender_kind = 'user' then 'open'
        when new.sender_kind = 'admin' then 'waiting_user'
        else status
      end,
      admin_read_at = case when new.sender_kind = 'user' and not new.is_internal then null else admin_read_at end,
      user_read_at = case when new.sender_kind = 'admin' and not new.is_internal then null else user_read_at end,
      resolved_at = case when new.sender_kind = 'user' then null else resolved_at end
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger sync_support_conversation_after_message
after insert on public.support_messages
for each row execute function public.sync_support_conversation_from_message();

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;

revoke all on table public.support_conversations, public.support_messages from public, anon, authenticated;
grant select on table public.support_conversations, public.support_messages to authenticated;

create policy "Users read own support conversations"
on public.support_conversations for select to authenticated
using (user_id = (select auth.uid()) or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin');

create policy "Users read own support messages"
on public.support_messages for select to authenticated
using (
  exists (
    select 1 from public.support_conversations conversation
    where conversation.id = conversation_id
      and (conversation.user_id = (select auth.uid()) or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin')
  )
  and (not is_internal or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin')
);

create or replace function public.mark_support_conversation_read(target_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  is_admin boolean := coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin';
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if is_admin then
    update public.support_conversations set admin_read_at = now() where id = target_conversation_id;
  else
    update public.support_conversations set user_read_at = now() where id = target_conversation_id and user_id = current_user_id;
  end if;
end;
$$;

revoke all on function public.mark_support_conversation_read(uuid) from public, anon;
grant execute on function public.mark_support_conversation_read(uuid) to authenticated;

create or replace function public.admin_support_conversations()
returns table (
  id uuid,
  user_id uuid,
  email text,
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
  select conversation.id, conversation.user_id, users.email::text, conversation.store_id,
    store.name, coalesce(store.pricing_plan, 'flexible'), conversation.subject, conversation.category,
    conversation.status, conversation.last_message_at, conversation.last_message_preview,
    conversation.admin_read_at is null, conversation.created_at
  from public.support_conversations conversation
  join auth.users users on users.id = conversation.user_id
  left join public.stores store on store.id = conversation.store_id
  order by (conversation.status = 'resolved'), conversation.last_message_at desc;
end;
$$;

revoke all on function public.admin_support_conversations() from public, anon;
grant execute on function public.admin_support_conversations() to authenticated;

drop function if exists public.admin_dashboard_users();
create function public.admin_dashboard_users()
returns table (
  user_id uuid,
  email text,
  user_created_at timestamptz,
  last_sign_in_at timestamptz,
  store_id uuid,
  store_name text,
  store_slug text,
  store_created_at timestamptz,
  is_published boolean,
  payment_status text,
  pricing_plan text,
  product_count bigint,
  order_count bigint,
  gross_sales numeric,
  last_activity_at timestamptz,
  has_store_details boolean,
  has_payments boolean,
  has_delivery boolean,
  has_product boolean,
  has_business_details boolean,
  has_published boolean,
  open_support_count bigint,
  last_support_at timestamptz
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
  select users.id, users.email::text, users.created_at, users.last_sign_in_at,
    store.id, store.name, store.slug, store.created_at, coalesce(store.is_published, false),
    coalesce(store.payment_status, 'idle'), coalesce(store.pricing_plan, 'flexible'),
    coalesce(products.product_count, 0), coalesce(orders.order_count, 0), coalesce(orders.gross_sales, 0),
    greatest(users.last_sign_in_at, store.updated_at, products.last_updated_at, orders.last_created_at),
    coalesce(nullif(btrim(store.name), '') is not null, false),
    coalesce(store.payment_status = 'connected', false),
    coalesce(cardinality(store.shipping) > 0, false),
    coalesce(products.product_count > 0, false),
    coalesce(nullif(btrim(store.settings ->> 'businessName'), '') is not null
      and (store.settings ->> 'registryCode') ~ '^\d{8}$'
      and nullif(btrim(store.settings ->> 'businessAddress'), '') is not null
      and nullif(btrim(store.settings ->> 'contactEmail'), '') is not null, false),
    coalesce(store.is_published, false), coalesce(support.open_count, 0), support.last_support_at
  from auth.users users
  left join lateral (select selected_store.* from public.stores selected_store where selected_store.owner_id = users.id order by selected_store.created_at limit 1) store on true
  left join lateral (select count(*)::bigint product_count, max(product.updated_at) last_updated_at from public.products product where product.store_id = store.id) products on true
  left join lateral (select count(*)::bigint order_count, coalesce(sum(order_row.product_subtotal) filter (where order_row.status <> 'refunded'), 0) gross_sales, max(order_row.updated_at) last_created_at from public.orders order_row where order_row.store_id = store.id) orders on true
  left join lateral (select count(*) filter (where conversation.status <> 'resolved')::bigint open_count, max(conversation.last_message_at) last_support_at from public.support_conversations conversation where conversation.user_id = users.id) support on true
  order by users.created_at desc;
end;
$$;

revoke all on function public.admin_dashboard_users() from public, anon;
grant execute on function public.admin_dashboard_users() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments', 'support-attachments', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Users upload own support attachments" on storage.objects for insert to authenticated
with check (bucket_id = 'support-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users read own support attachments" on storage.objects for select to authenticated
using (bucket_id = 'support-attachments' and ((storage.foldername(name))[1] = (select auth.uid())::text or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin'));

create trigger signal_admin_dashboard_after_support_conversations
after insert or update or delete on public.support_conversations
for each statement execute function public.signal_admin_dashboard_refresh();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_messages') then
    alter publication supabase_realtime add table public.support_messages;
  end if;
end $$;
