update public.stores
set payment_status = 'idle'
where payment_provider = 'stripe'
  and stripe_account_id is null
  and payment_status <> 'idle';
