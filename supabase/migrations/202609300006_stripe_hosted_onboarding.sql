alter table public.stores drop constraint if exists stores_stripe_connection_type_check;
alter table public.stores add constraint stores_stripe_connection_type_check
  check (stripe_connection_type in ('managed', 'oauth', 'hosted'));

-- OAuth attachment is retired. Existing linked accounts remain usable.
revoke execute on function public.attach_stripe_oauth_account(text,uuid,text,text,jsonb) from service_role;
