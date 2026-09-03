create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, slug)
);

create index product_categories_store_order_idx
on public.product_categories(store_id, sort_order, name);

create trigger product_categories_updated_at
before update on public.product_categories
for each row execute function public.set_updated_at();

alter table public.product_categories enable row level security;

grant select on public.product_categories to anon;
grant select, insert, update, delete on public.product_categories to authenticated;

create policy "Public and owners read product categories"
on public.product_categories for select to anon, authenticated
using (
  (select public.is_store_public(store_id))
  or (select public.is_store_owner(store_id))
);

create policy "Owners create product categories"
on public.product_categories for insert to authenticated
with check ((select public.is_store_owner(store_id)));

create policy "Owners update product categories"
on public.product_categories for update to authenticated
using ((select public.is_store_owner(store_id)))
with check ((select public.is_store_owner(store_id)));

create policy "Owners delete product categories"
on public.product_categories for delete to authenticated
using ((select public.is_store_owner(store_id)));

create policy "Admins create demo product categories"
on public.product_categories for insert to authenticated
with check (
  store_id = '00000000-0000-4000-8000-000000000001'
  and (select public.is_admin())
);

create policy "Admins update demo product categories"
on public.product_categories for update to authenticated
using (
  store_id = '00000000-0000-4000-8000-000000000001'
  and (select public.is_admin())
)
with check (
  store_id = '00000000-0000-4000-8000-000000000001'
  and (select public.is_admin())
);

create policy "Admins delete demo product categories"
on public.product_categories for delete to authenticated
using (
  store_id = '00000000-0000-4000-8000-000000000001'
  and (select public.is_admin())
);

alter table public.products
add column category_id uuid references public.product_categories(id) on delete set null;

create index products_category_id_idx on public.products(category_id)
where category_id is not null;

-- A category UUID may only be attached to a product in the same store. The
-- regular foreign key handles deletion, while this trigger enforces tenancy.
create or replace function public.ensure_product_category_store()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category_id is not null and not exists (
    select 1
    from public.product_categories category
    where category.id = new.category_id
      and category.store_id = new.store_id
  ) then
    raise exception 'Product category must belong to the same store.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_product_category_store() from public;

create trigger products_category_store_guard
before insert or update of store_id, category_id on public.products
for each row execute function public.ensure_product_category_store();
