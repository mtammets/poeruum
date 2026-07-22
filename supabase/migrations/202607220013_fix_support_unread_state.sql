-- A reply marks the conversation unread for the other party. Both read
-- timestamps must therefore allow NULL while a message is waiting to be read.
alter table public.support_conversations
  alter column user_read_at drop not null;
