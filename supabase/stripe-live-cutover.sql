-- Käivita see fail ainult üks kord vahetult enne Stripe live-võtmete paigaldamist.
-- See eemaldab testkeskkonna Stripe'i viited, kuid säilitab tellimuste ajaloo.
begin;

do $$
begin
  if exists (
    select 1 from public.stores
    where stripe_account_mode = 'live' or stripe_billing_mode = 'live'
  ) then
    raise exception 'Live Stripe viited on juba olemas; cutover katkestati.';
  end if;
end;
$$;

update public.stores
set stripe_account_id = null,
    stripe_account_mode = null,
    stripe_account_charges_enabled = false,
    stripe_account_payouts_enabled = false,
    payment_status = case when payment_provider = 'stripe' then 'idle' else payment_status end,
    stripe_customer_id = null,
    stripe_subscription_id = null,
    stripe_subscription_status = null,
    stripe_billing_mode = null,
    pricing_plan = case when pricing_plan = 'fixed' then 'flexible' else pricing_plan end
where stripe_account_mode = 'test'
   or stripe_billing_mode = 'test'
   or stripe_account_id is not null
   or stripe_customer_id is not null
   or stripe_subscription_id is not null;

update public.orders
set payment_status = 'failed',
    reservation_expires_at = null
where stripe_mode = 'test' and payment_status = 'pending';

-- Testrežiimi tulu ei tohi pärast live-käivitust admini tulukaardile jääda.
delete from public.revenue_events
where metadata ->> 'livemode' = 'false';

commit;
