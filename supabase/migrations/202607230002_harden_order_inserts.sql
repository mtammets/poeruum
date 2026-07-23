drop policy if exists "Customers create orders" on public.orders;

revoke insert on table public.orders from anon, authenticated;
grant insert on table public.orders to service_role;

comment on table public.orders is
  'Orders are created only by trusted server-side checkout functions; storefront clients cannot insert rows directly.';
