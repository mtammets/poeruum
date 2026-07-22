alter table public.orders
  add column if not exists customer_confirmation_sent_at timestamptz,
  add column if not exists seller_notification_sent_at timestamptz;

comment on column public.orders.customer_confirmation_sent_at is 'Aeg, mil Resend võttis kliendi tellimuskinnituse vastu.';
comment on column public.orders.seller_notification_sent_at is 'Aeg, mil Resend võttis müüja tellimusteavituse vastu.';
