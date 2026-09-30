-- Distinguish unloaded account data from an incomplete Stripe setup.
create or replace function public.admin_payment_reviews()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('orders',coalesce((select jsonb_agg(row_to_json(q)) from (
    select o.id,o.order_number,s.name as store_name,o.stripe_mode,o.stripe_payment_intent_id,o.stripe_payment_issue,
      o.stripe_dispute_id,o.stripe_dispute_status,o.stripe_refunded_amount_cents,j.status,j.last_error,o.payment_status
    from public.orders o join public.stores s on s.id=o.store_id left join public.stripe_order_settlements j on j.order_id=o.id
    where o.stripe_payment_issue is not null or j.status='needs_review' order by o.updated_at desc limit 200) q),'[]'::jsonb),
    'sellers',coalesce((select jsonb_agg(row_to_json(q)) from (
      select s.id,s.name,s.settings->>'businessName' as seller_name,s.stripe_account_id,s.stripe_account_mode,
        c.bank,c.identity_error,c.verified_at,c.checked_at,c.stripe_ready
      from public.stores s left join public.store_payment_checks c on c.store_id=s.id
      where s.settings->>'sellerType'='entrepreneur' and s.stripe_account_id is not null
      order by c.verified_at nulls first,s.created_at limit 200) q),'[]'::jsonb));
end;
$$;
