alter table public.products
  drop constraint if exists products_slug_format;

alter table public.products
  add constraint products_slug_format
  check (slug is null or slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

create unique index if not exists products_store_slug_unique
  on public.products (store_id, slug)
  where slug is not null;
