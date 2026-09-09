-- Receipt links are bearer credentials. Keep them out of public store/order
-- projections and place them in the browser URL fragment, never in analytics.
create table public.order_receipt_access (
  order_id uuid primary key references public.orders(id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now(),
  constraint order_receipt_token_format check (token ~ '^[0-9a-f]{64}$')
);
alter table public.order_receipt_access enable row level security;
revoke all on public.order_receipt_access from public, anon, authenticated;
grant select, insert on public.order_receipt_access to service_role;

create function public.get_or_create_order_receipt_token(target_order_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare receipt_token text;
begin
  -- Serialize retries with checkout/payment writes without rotating the link.
  perform 1 from public.orders where id = target_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  insert into public.order_receipt_access(order_id) values (target_order_id)
    on conflict (order_id) do nothing;
  select token into receipt_token from public.order_receipt_access where order_id = target_order_id;
  return receipt_token;
end;
$$;
revoke all on function public.get_or_create_order_receipt_token(uuid) from public, anon, authenticated;
grant execute on function public.get_or_create_order_receipt_token(uuid) to service_role;
