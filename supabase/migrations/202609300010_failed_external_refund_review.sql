-- A failed or canceled refund remains an operator case even after a prior
-- completion. Never silently issue a replacement refund or discard its history.
create or replace function public.observe_stripe_order_payment(target_order_id uuid, mode_value text,
  refunded_cents integer, full_refund_id text default null, dispute_id_value text default null, dispute_status_value text default null, refund_review_value text default null)
returns void language plpgsql security definer set search_path='' as $$
declare payment public.orders%rowtype; job public.stripe_order_settlements%rowtype; issue text; full_refund boolean;
begin
  select * into payment from public.orders where id=target_order_id for update;
  if not found or payment.stripe_mode is distinct from mode_value or payment.payment_status not in ('paid','refunded') then
    raise exception 'PAYMENT_OBSERVATION_MISMATCH';
  end if;
  if refunded_cents < 0 or refunded_cents > round(payment.total*100)::integer then raise exception 'INVALID_REFUND_AMOUNT'; end if;
  -- Refunds are monotonic; delayed webhook deliveries cannot undo a refund.
  refunded_cents := greatest(refunded_cents,payment.stripe_refunded_amount_cents);
  full_refund := refunded_cents=round(payment.total*100)::integer;
  issue := payment.stripe_payment_issue;
  if refund_review_value in ('partial_refund','review') and issue is distinct from 'dispute' then issue:=refund_review_value; end if;
  if dispute_id_value is not null then
    if dispute_status_value in ('won','warning_closed') then
      if issue='dispute' then issue:=null; end if;
    else issue:='dispute'; end if;
  end if;
  if full_refund and issue='partial_refund' then issue:=null; end if;
  if refunded_cents>0 and not full_refund and issue is distinct from 'dispute' then issue:='partial_refund'; end if;
  update public.orders set stripe_refunded_amount_cents=refunded_cents,
    stripe_payment_issue=issue,
    stripe_dispute_id=coalesce(dispute_id_value,stripe_dispute_id),
    stripe_dispute_status=coalesce(dispute_status_value,stripe_dispute_status),
    stripe_refund_id=coalesce(full_refund_id,stripe_refund_id),
    stripe_refund_status=case when full_refund then 'succeeded' else stripe_refund_status end,
    payment_status=case when full_refund then 'refunded' else payment_status end,
    status=case when full_refund then 'refunded' else status end
    where id=target_order_id;
  insert into public.stripe_order_settlements(order_id,stripe_mode) values(target_order_id,mode_value) on conflict do nothing;
  select * into job from public.stripe_order_settlements where order_id=target_order_id for update;
  if full_refund then
    update public.stripe_order_settlements set refund_requested_at=coalesce(refund_requested_at,now()),
      stripe_refund_id=coalesce(full_refund_id,stripe_refund_id),
      status=case when lease_expires_at>now() or status='refunded' or issue in ('dispute','funds_required') then status else 'pending' end,
      next_attempt_at=now() where order_id=target_order_id;
  elsif issue in ('partial_refund','dispute','review') then
    update public.stripe_order_settlements set status=case when lease_expires_at>now() then status else 'needs_review' end,
      last_error=case when issue='dispute' then 'Stripe’i makse on vaidlustatud. Ava vaidlus Stripe’is.' when issue='partial_refund' then 'Stripe’is on tehtud osaline tagastus. Kontrolli arvestust Stripe’is.' else 'Stripe’i tagastus ebaõnnestus või tühistati. Kontrolli makset Stripe’is.' end
      where order_id=target_order_id;
  elsif payment.stripe_payment_issue='dispute' and issue is null and job.status='needs_review' then
    update public.stripe_order_settlements set status='pending',next_attempt_at=now() where order_id=target_order_id;
  end if;
end;
$$;
