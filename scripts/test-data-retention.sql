\set ON_ERROR_STOP on

begin;

insert into public.stores (
  id, owner_id, name, slug, is_published, shipping, settings, deleted_at
) values (
  '10000000-0000-4000-8000-000000000001',
  null,
  'Retention test store',
  'retention-test-store',
  false,
  '{}'::text[],
  '{}'::jsonb,
  now() - interval '8 years'
);

insert into public.orders (
  id, store_id, order_number, items, customer_name, customer_email, delivery,
  product_subtotal, total, retention_expires_at
) values
(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'RETENTION-EXPIRED',
  '[]'::jsonb,
  'Expired buyer',
  'expired@example.invalid',
  'Expired address',
  1,
  1,
  current_date
),
(
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  'RETENTION-ACTIVE',
  '[]'::jsonb,
  'Active buyer',
  'active@example.invalid',
  'Active address',
  1,
  1,
  current_date + 1
),
(
  '20000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'RETENTION-HELD',
  '[]'::jsonb,
  'Held buyer',
  'held@example.invalid',
  'Held address',
  1,
  1,
  current_date
);

update public.orders
set retention_hold_until = now() + interval '1 day'
where order_number = 'RETENTION-HELD';

insert into public.email_deliveries (
  resend_email_id, recipient_email, status, sent_at, status_updated_at
) values
  ('retention-expired', 'expired@example.invalid', 'delivered', now() - interval '91 days', now() - interval '91 days'),
  ('retention-active', 'active@example.invalid', 'delivered', now() - interval '89 days', now() - interval '89 days');

select public.apply_data_retention(now());

do $$
begin
  if exists (select 1 from public.orders where order_number = 'RETENTION-EXPIRED') then
    raise exception 'Expired order was not deleted';
  end if;
  if not exists (select 1 from public.orders where order_number = 'RETENTION-ACTIVE') then
    raise exception 'Unexpired order was deleted';
  end if;
  if not exists (select 1 from public.orders where order_number = 'RETENTION-HELD') then
    raise exception 'Order under legal hold was deleted';
  end if;
  if exists (select 1 from public.email_deliveries where resend_email_id = 'retention-expired') then
    raise exception 'Expired email delivery log was not deleted';
  end if;
  if not exists (select 1 from public.email_deliveries where resend_email_id = 'retention-active') then
    raise exception 'Unexpired email delivery log was deleted';
  end if;
  if not exists (select 1 from public.stores where slug = 'retention-test-store') then
    raise exception 'Tombstone with an unexpired order was deleted';
  end if;
end
$$;

rollback;
