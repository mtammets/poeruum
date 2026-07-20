alter table public.products
add column if not exists image_transforms jsonb not null default '{}'::jsonb;

alter table public.products
drop constraint if exists products_image_transforms_object;

alter table public.products
add constraint products_image_transforms_object
check (jsonb_typeof(image_transforms) = 'object');
