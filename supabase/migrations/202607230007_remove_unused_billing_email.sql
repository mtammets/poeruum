update public.stores
set settings = settings - 'billingEmail'
where settings ? 'billingEmail';
