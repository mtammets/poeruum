-- Reuse the launch-page showcase photography in the public demo storefront.
insert into public.products (
  id, store_id, name, description, image_url, gallery, alt, price, sale_price,
  object_position, slug, search_visible, stock, one_of_a_kind, options, sort_order
)
values
  (
    'demo-product-8', '00000000-0000-4000-8000-000000000001', 'Lamp Sammal',
    'Sügavrohelise skulptuurse jalaga laualamp, mille pehme kuppel loob mõnusa valguse.',
    '/images/demo/lamp_sammal.webp', '["/images/demo/lamp_sammal.webp"]',
    'Rohelise keraamilise jalaga laualamp', 79, null, 'center 50%', 'lamp-sammal', true, 3, false, '[]', 8
  ),
  (
    'demo-product-9', '00000000-0000-4000-8000-000000000001', 'Vaas Laine',
    'Sügavsinisest lainelisest klaasist vaas, mis püüab kaunilt valgust.',
    '/images/demo/vaas_laine.webp', '["/images/demo/vaas_laine.webp"]',
    'Sinisest klaasist ümar vaas oksaga', 49, null, 'center 50%', 'vaas-laine', true, 1, true, '[]', 9
  ),
  (
    'demo-product-10', '00000000-0000-4000-8000-000000000001', 'Alus Täpe',
    'Käsitööna valminud täpiline keraamiline alus koos väikese sobiva tassiga.',
    '/images/demo/alus_tape.webp', '["/images/demo/alus_tape.webp"]',
    'Täpiline keraamiline alus väikese tassiga', 39, null, 'center 50%', 'alus-tape', true, 4, false, '[]', 10
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  image_url = excluded.image_url,
  gallery = excluded.gallery,
  alt = excluded.alt,
  price = excluded.price,
  sale_price = excluded.sale_price,
  object_position = excluded.object_position,
  slug = excluded.slug,
  search_visible = excluded.search_visible,
  stock = excluded.stock,
  one_of_a_kind = excluded.one_of_a_kind,
  options = excluded.options,
  sort_order = excluded.sort_order;
