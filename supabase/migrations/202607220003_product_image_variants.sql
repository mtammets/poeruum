alter table public.products
add column if not exists image_variants jsonb not null default '{}'::jsonb;

alter table public.products
drop constraint if exists products_image_variants_object;

alter table public.products
add constraint products_image_variants_object
check (jsonb_typeof(image_variants) = 'object');
