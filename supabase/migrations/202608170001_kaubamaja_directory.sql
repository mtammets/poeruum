do $$
declare
  urgits_store_id constant uuid := '9c3f64f4-d8aa-4262-bda8-b2f198b2e01f';
begin
  if exists (
    select 1 from public.stores
    where lower(slug) = 'kaubamaja' and id <> urgits_store_id
  ) then
    raise exception 'The kaubamaja slug belongs to an unexpected store; migration stopped safely.';
  end if;

  if exists (
    select 1 from public.stores
    where id = urgits_store_id and lower(slug) = 'kaubamaja'
  ) then
    if exists (
      select 1 from public.stores
      where lower(slug) = 'urgits' and id <> urgits_store_id
    ) then
      raise exception 'The urgits slug is already in use; migration stopped safely.';
    end if;

    update public.stores
    set slug = 'urgits'
    where id = urgits_store_id;
  end if;
end;
$$;

alter table public.stores
  drop constraint if exists stores_slug_not_reserved;

alter table public.stores
  add constraint stores_slug_not_reserved
  check (lower(slug) not in (
    'admin', 'api', 'app', 'assets', 'auth', 'cdn', 'domains', 'kaubamaja',
    'mail', 'send', 'static', 'status', 'support', 'tugi', 'www'
  )) not valid;

alter table public.stores
  validate constraint stores_slug_not_reserved;

comment on constraint stores_slug_not_reserved on public.stores is
  'Keeps infrastructure and first-party Poeruum subdomains unavailable as store addresses.';
