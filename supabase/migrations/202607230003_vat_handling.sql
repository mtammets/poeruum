alter table public.orders
  add column if not exists seller_vat_registered boolean not null default false,
  add column if not exists seller_vat_number text,
  add column if not exists seller_vat_rate numeric(5, 2),
  add column if not exists seller_vat_amount numeric(12, 2) not null default 0,
  add column if not exists stripe_platform_fee_net_cents integer not null default 0
    check (stripe_platform_fee_net_cents >= 0),
  add column if not exists stripe_platform_fee_vat_cents integer not null default 0
    check (stripe_platform_fee_vat_cents >= 0);

alter table public.orders
  add constraint orders_seller_vat_number_format
  check (seller_vat_number is null or seller_vat_number ~ '^EE[0-9]{9}$');

comment on column public.orders.seller_vat_registered is
  'Seller VAT status captured when checkout starts.';
comment on column public.orders.seller_vat_number is
  'Seller Estonian VAT number captured when checkout starts.';
comment on column public.orders.seller_vat_rate is
  'VAT rate captured for the order. The current storefront supports the Estonian 24% standard rate.';
comment on column public.orders.seller_vat_amount is
  'VAT included in the customer-facing gross order total.';
comment on column public.orders.stripe_platform_fee_net_cents is
  'Poeruum transaction fee before VAT.';
comment on column public.orders.stripe_platform_fee_vat_cents is
  'VAT charged on the Poeruum transaction fee.';
