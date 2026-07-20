create extension if not exists pgcrypto;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  is_published boolean not null default false,
  payment_provider text not null default 'stripe' check (payment_provider in ('stripe', 'montonio')),
  payment_status text not null default 'idle' check (payment_status in ('idle', 'connected', 'pending')),
  pricing_plan text not null default 'flexible' check (pricing_plan in ('flexible', 'fixed')),
  trial_started_at timestamptz,
  shipping text[] not null default array['omniva', 'pickup']::text[],
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stores_owner_id_idx on public.stores(owner_id);

create table public.products (
  id text primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  description text not null default '',
  image_url text not null,
  gallery jsonb not null default '[]'::jsonb,
  alt text not null default '',
  price numeric(12,2) check (price >= 0),
  sale_price numeric(12,2) check (sale_price >= 0),
  object_position text,
  slug text,
  seo_title text,
  search_visible boolean not null default true,
  stock integer check (stock >= 0),
  one_of_a_kind boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, slug)
);
create index products_store_id_idx on public.products(store_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_number text not null,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  customer_name text not null,
  customer_email text not null,
  delivery text not null,
  product_subtotal numeric(12,2) not null check (product_subtotal >= 0),
  total numeric(12,2) not null check (total >= 0),
  status text not null default 'new' check (status in ('new', 'fulfilled', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, order_number)
);
create index orders_store_id_created_at_idx on public.orders(store_id, created_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger stores_updated_at before update on public.stores for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();

create or replace function public.is_store_owner(target_store_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.stores where id = target_store_id and owner_id = (select auth.uid()));
$$;

alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;

create policy "Published stores are public" on public.stores for select to anon, authenticated using (is_published or owner_id = (select auth.uid()));
create policy "Owners create stores" on public.stores for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners update stores" on public.stores for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners delete stores" on public.stores for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Published products are public" on public.products for select to anon, authenticated
using (exists(select 1 from public.stores s where s.id = store_id and (s.is_published or s.owner_id = (select auth.uid()))));
create policy "Owners create products" on public.products for insert to authenticated with check ((select public.is_store_owner(store_id)));
create policy "Owners update products" on public.products for update to authenticated using ((select public.is_store_owner(store_id))) with check ((select public.is_store_owner(store_id)));
create policy "Owners delete products" on public.products for delete to authenticated using ((select public.is_store_owner(store_id)));

create policy "Customers create orders" on public.orders for insert to anon, authenticated
with check (status = 'new' and exists(select 1 from public.stores s where s.id = store_id and s.is_published));
create policy "Owners read orders" on public.orders for select to authenticated using ((select public.is_store_owner(store_id)));
create policy "Owners update orders" on public.orders for update to authenticated using ((select public.is_store_owner(store_id))) with check ((select public.is_store_owner(store_id)));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif','image/avif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Public product images" on storage.objects for select to public using (bucket_id = 'product-images');
create policy "Owners upload product images" on storage.objects for insert to authenticated
with check (bucket_id = 'product-images' and (select public.is_store_owner((storage.foldername(name))[1]::uuid)));
create policy "Owners update product images" on storage.objects for update to authenticated
using (bucket_id = 'product-images' and (select public.is_store_owner((storage.foldername(name))[1]::uuid)));
create policy "Owners delete product images" on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and (select public.is_store_owner((storage.foldername(name))[1]::uuid)));
