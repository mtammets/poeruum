alter table public.stores
  add constraint stores_slug_not_reserved
  check (slug not in (
    'admin', 'api', 'app', 'assets', 'auth', 'cdn', 'domains', 'mail',
    'send', 'static', 'status', 'support', 'tugi', 'www'
  )) not valid;

comment on constraint stores_slug_not_reserved on public.stores is
  'Keeps infrastructure and first-party Poeruum subdomains unavailable as store addresses.';
