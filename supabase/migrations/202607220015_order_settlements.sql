alter table public.orders
  add column if not exists stripe_transfer_id text unique,
  add column if not exists stripe_processing_fee_cents integer not null default 0
    check (stripe_processing_fee_cents >= 0),
  add column if not exists stripe_platform_fee_cents integer not null default 0
    check (stripe_platform_fee_cents >= 0),
  add column if not exists stripe_seller_net_cents integer not null default 0
    check (stripe_seller_net_cents >= 0);

comment on column public.orders.stripe_processing_fee_cents is
  'Stripe actual processing fee retained before the seller transfer.';
comment on column public.orders.stripe_platform_fee_cents is
  'Poeruum transaction fee retained before the seller transfer.';
comment on column public.orders.stripe_seller_net_cents is
  'Amount transferred to the connected seller account.';
