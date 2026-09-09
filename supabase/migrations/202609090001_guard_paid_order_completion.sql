-- Payment confirmation can precede settlement. Retries must preserve a refund
-- and cannot rebind an existing order to a different checkout or payment.
create or replace function public.complete_stripe_order(
  target_order_id uuid,
  checkout_session_id text,
  payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  order_item jsonb;
  item_quantity integer;
begin
  select * into target from public.orders where id = target_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if nullif(btrim(checkout_session_id), '') is null
    or nullif(btrim(payment_intent_id), '') is null then
    raise exception 'PAYMENT_REFERENCE_REQUIRED';
  end if;
  if (target.stripe_checkout_session_id is not null and target.stripe_checkout_session_id <> checkout_session_id)
    or (target.stripe_payment_intent_id is not null and target.stripe_payment_intent_id <> payment_intent_id) then
    raise exception 'ORDER_PAYMENT_MISMATCH';
  end if;
  if target.payment_status in ('paid', 'refunded') then return; end if;

  update public.orders
  set payment_status = 'paid', reservation_expires_at = null,
      stripe_checkout_session_id = checkout_session_id,
      stripe_payment_intent_id = payment_intent_id
  where id = target_order_id;

  for order_item in select * from jsonb_array_elements(target.items)
  loop
    item_quantity := greatest(1, coalesce((order_item ->> 'quantity')::integer, 1));
    update public.products
    set stock = greatest(0, stock - item_quantity)
    where store_id = target.store_id and id = order_item ->> 'id' and stock is not null;
  end loop;
end;
$$;

revoke all on function public.complete_stripe_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_stripe_order(uuid, text, text) to service_role;
